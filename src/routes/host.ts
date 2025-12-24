import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import crypto from "crypto";
import { gcsBucket, gcsPublicUrl } from "../../lib/gcs.js";

/**
 * Host routes (future-proof V1)
 * - Scoped to authenticated Firebase UID (req.authUser.uid)
 * - Never accepts userId from the client
 * - Uses users.firebase_uid -> users.id to join to hosts/cars
 *
 * Mounted with prefix "/api" in app.ts:
 *   /api/host/me
 *   /api/host/register
 *   /api/host/profile
 *   /api/host/cars
 *   /api/host/cars/:id
 *   /api/host/cars/:id/publish
 *   /api/host/cars/:id/unpublish
 */

type HostStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "suspended"
  | "archived";

type HostType = "individual" | "business";

function getAuth(req: any): { uid: string; raw: any } | null {
  if (req.authUser?.uid)
    return { uid: String(req.authUser.uid), raw: req.authUser };
  const legacy = req.user;
  if (legacy?.uid) return { uid: String(legacy.uid), raw: legacy };
  return null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function getDbUserIdByFirebaseUid(
  app: any,
  firebaseUid: string
): Promise<string | null> {
  const { rows } = await app.db.query(
    `
    SELECT id
    FROM users
    WHERE firebase_uid = $1
    LIMIT 1
    `,
    [firebaseUid]
  );
  return rows[0]?.id ?? null;
}

async function getHostByUserId(app: any, userId: string) {
  const { rows } = await app.db.query(
    `
    SELECT *
    FROM hosts
    WHERE user_id = $1
    LIMIT 1
    `,
    [userId]
  );
  return rows[0] ?? null;
}

function sanitizeHostPatch(body: any) {
  // Allow-list only: add new keys here as schema evolves.
  const patch: Record<string, any> = {};

  if (isNonEmptyString(body?.display_name))
    patch.display_name = body.display_name.trim();

  if (isNonEmptyString(body?.base_country_code))
    patch.base_country_code = body.base_country_code.trim().toUpperCase();
  if (typeof body?.base_city === "string")
    patch.base_city = body.base_city.trim() || null;
  if (typeof body?.base_area === "string")
    patch.base_area = body.base_area.trim() || null;

  if (typeof body?.instant_book_enabled === "boolean")
    patch.instant_book_enabled = body.instant_book_enabled;

  if (
    typeof body?.advance_notice_hours === "number" &&
    Number.isFinite(body.advance_notice_hours)
  ) {
    patch.advance_notice_hours = clampInt(
      Math.trunc(body.advance_notice_hours),
      0,
      720
    );
  }

  if (
    typeof body?.min_trip_days === "number" &&
    Number.isFinite(body.min_trip_days)
  ) {
    patch.min_trip_days = clampInt(Math.trunc(body.min_trip_days), 1, 365);
  }

  if (body?.max_trip_days === null) patch.max_trip_days = null;
  else if (
    typeof body?.max_trip_days === "number" &&
    Number.isFinite(body.max_trip_days)
  ) {
    patch.max_trip_days = clampInt(Math.trunc(body.max_trip_days), 1, 3650);
  }

  if (typeof body?.cancellation_policy === "string")
    patch.cancellation_policy = body.cancellation_policy.trim();
  if (typeof body?.allowed_drivers === "string")
    patch.allowed_drivers = body.allowed_drivers.trim();

  if (typeof body?.smoking_allowed === "boolean")
    patch.smoking_allowed = body.smoking_allowed;
  if (typeof body?.pets_allowed === "boolean")
    patch.pets_allowed = body.pets_allowed;

  // JSONB bags (optional)
  if (
    body?.verification &&
    typeof body.verification === "object" &&
    !Array.isArray(body.verification)
  ) {
    patch.verification = body.verification;
  }
  if (
    body?.payouts &&
    typeof body.payouts === "object" &&
    !Array.isArray(body.payouts)
  ) {
    patch.payouts = body.payouts;
  }
  if (
    body?.metadata &&
    typeof body.metadata === "object" &&
    !Array.isArray(body.metadata)
  ) {
    patch.metadata = body.metadata;
  }

  return patch;
}

function buildUpdateSql(
  table: string,
  patch: Record<string, any>,
  whereSql: string,
  whereParams: any[]
) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return null;

  const sets: string[] = [];
  const values: any[] = [];

  keys.forEach((k, i) => {
    sets.push(`${k} = $${i + 1}`);
    values.push(patch[k]);
  });

  sets.push(`updated_at = now()`);

  const sql = `
    UPDATE ${table}
    SET ${sets.join(", ")}
    ${whereSql}
    RETURNING *
  `;

  return { sql, params: [...values, ...whereParams] };
}

function sanitizeCarCreate(body: any) {
  const out: Record<string, any> = {};

  if (isNonEmptyString(body?.title)) out.title = body.title.trim();
  if (isNonEmptyString(body?.vehicle_type))
    out.vehicle_type = body.vehicle_type.trim();
  if (isNonEmptyString(body?.transmission))
    out.transmission = body.transmission.trim();

  if (typeof body?.seats === "number" && Number.isFinite(body.seats))
    out.seats = clampInt(Math.trunc(body.seats), 1, 99);

  if (
    typeof body?.price_per_day === "number" &&
    Number.isFinite(body.price_per_day)
  )
    out.price_per_day = clampInt(Math.trunc(body.price_per_day), 0, 1_000_000);

  if (typeof body?.country_code === "string")
    out.country_code = body.country_code.trim().toUpperCase();
  if (typeof body?.city === "string") out.city = body.city.trim();
  if (typeof body?.area === "string") out.area = body.area.trim() || null;
  if (typeof body?.full_address === "string")
    out.full_address = body.full_address.trim();

  if (typeof body?.pickup_lat === "number" && Number.isFinite(body.pickup_lat))
    out.pickup_lat = body.pickup_lat;
  if (typeof body?.pickup_lng === "number" && Number.isFinite(body.pickup_lng))
    out.pickup_lng = body.pickup_lng;
  if (typeof body?.pickup_address === "string")
    out.pickup_address = body.pickup_address.trim() || null;

  if (typeof body?.image_path === "string")
    out.image_path = body.image_path.trim();
  if (typeof body?.image_public === "boolean")
    out.image_public = body.image_public;
  if (typeof body?.has_image === "boolean") out.has_image = body.has_image;

  if (typeof body?.is_popular === "boolean") out.is_popular = body.is_popular;
  if (typeof body?.is_featured === "boolean")
    out.is_featured = body.is_featured;

  if (body?.image_gallery && Array.isArray(body.image_gallery))
    out.image_gallery = body.image_gallery;
  if (
    body?.features &&
    typeof body.features === "object" &&
    !Array.isArray(body.features)
  )
    out.features = body.features;
  if (
    body?.requirements &&
    typeof body.requirements === "object" &&
    !Array.isArray(body.requirements)
  )
    out.requirements = body.requirements;
  if (
    body?.pricing_rules &&
    typeof body.pricing_rules === "object" &&
    !Array.isArray(body.pricing_rules)
  )
    out.pricing_rules = body.pricing_rules;

  return out;
}

function sanitizeCarPatch(body: any) {
  const out: Record<string, any> = {};

  if (typeof body?.title === "string") out.title = body.title.trim();
  if (typeof body?.vehicle_type === "string")
    out.vehicle_type = body.vehicle_type.trim();
  if (typeof body?.transmission === "string")
    out.transmission = body.transmission.trim();

  if (typeof body?.seats === "number" && Number.isFinite(body.seats))
    out.seats = clampInt(Math.trunc(body.seats), 1, 99);

  if (
    typeof body?.price_per_day === "number" &&
    Number.isFinite(body.price_per_day)
  )
    out.price_per_day = clampInt(Math.trunc(body.price_per_day), 0, 1_000_000);

  if (typeof body?.country_code === "string")
    out.country_code = body.country_code.trim().toUpperCase();
  if (typeof body?.city === "string") out.city = body.city.trim();
  if (typeof body?.area === "string") out.area = body.area.trim() || null;
  if (typeof body?.full_address === "string")
    out.full_address = body.full_address.trim();

  if (typeof body?.pickup_lat === "number" && Number.isFinite(body.pickup_lat))
    out.pickup_lat = body.pickup_lat;
  if (typeof body?.pickup_lng === "number" && Number.isFinite(body.pickup_lng))
    out.pickup_lng = body.pickup_lng;
  if (typeof body?.pickup_address === "string")
    out.pickup_address = body.pickup_address.trim() || null;

  if (typeof body?.image_path === "string")
    out.image_path = body.image_path.trim();
  if (typeof body?.image_public === "boolean")
    out.image_public = body.image_public;
  if (typeof body?.has_image === "boolean") out.has_image = body.has_image;

  if (typeof body?.is_popular === "boolean") out.is_popular = body.is_popular;
  if (typeof body?.is_featured === "boolean")
    out.is_featured = body.is_featured;

  if (body?.image_gallery && Array.isArray(body.image_gallery))
    out.image_gallery = body.image_gallery;
  if (
    body?.features &&
    typeof body.features === "object" &&
    !Array.isArray(body.features)
  )
    out.features = body.features;
  if (
    body?.requirements &&
    typeof body.requirements === "object" &&
    !Array.isArray(body.requirements)
  )
    out.requirements = body.requirements;
  if (
    body?.pricing_rules &&
    typeof body.pricing_rules === "object" &&
    !Array.isArray(body.pricing_rules)
  )
    out.pricing_rules = body.pricing_rules;

  return out;
}

const hostRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/host/me
   */
  app.get("/host/me", { preHandler: app.authenticate }, async (req, reply) => {
    const auth = getAuth(req);
    if (!auth) return reply.code(401).send({ error: "Unauthorized" });

    try {
      const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
      if (!userId) return reply.code(404).send({ error: "User not found" });

      const host = await getHostByUserId(app, userId);
      return reply.send({ host: host ?? null });
    } catch (e: any) {
      req.log.error({ err: e }, "GET /host/me failed");
      return reply.code(500).send({
        error: "INTERNAL_ERROR",
        message: "Failed to load host profile.",
      });
    }
  });

  /**
   * POST /api/host/register
   * Creates host row if missing; returns existing if already registered.
   */
  app.post(
    "/host/register",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const body = (req.body ?? {}) as Partial<{
        display_name: string;
        host_type: HostType;
        base_country_code: string;
        base_city: string;
        base_area: string;
        submit: boolean; // if true => pending_review
      }>;

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const existing = await getHostByUserId(app, userId);
        if (existing) return reply.send({ host: existing, created: false });

        const displayName = isNonEmptyString(body.display_name)
          ? body.display_name.trim()
          : "Host";
        const hostType: HostType =
          body.host_type === "business" ? "business" : "individual";

        const baseCountry = isNonEmptyString(body.base_country_code)
          ? body.base_country_code.trim().toUpperCase()
          : "CA";

        const baseCity =
          typeof body.base_city === "string"
            ? body.base_city.trim() || null
            : null;
        const baseArea =
          typeof body.base_area === "string"
            ? body.base_area.trim() || null
            : null;

        const submit = body.submit === true;
        const status: HostStatus = submit ? "pending_review" : "draft";

        const { rows } = await app.db.query(
          `
        INSERT INTO hosts (
          user_id,
          status,
          host_type,
          display_name,
          base_country_code,
          base_city,
          base_area,
          submitted_at
        )
        VALUES (
          $1,
          $2::host_status,
          $3::host_type,
          $4,
          $5,
          $6,
          $7,
          CASE WHEN $8::boolean = true THEN now() ELSE NULL END
        )
        RETURNING *
        `,
          [
            userId,
            status,
            hostType,
            displayName,
            baseCountry,
            baseCity,
            baseArea,
            submit,
          ]
        );

        return reply.code(201).send({ host: rows[0], created: true });
      } catch (e: any) {
        req.log.error({ err: e }, "POST /host/register failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to register as host.",
        });
      }
    }
  );

  /**
   * PATCH /api/host/profile
   */
  app.patch(
    "/host/profile",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const host = await getHostByUserId(app, userId);
        if (!host)
          return reply.code(404).send({
            error: "HOST_NOT_FOUND",
            message: "Host profile not found.",
          });

        const patch = sanitizeHostPatch(req.body);
        const upd = buildUpdateSql(
          "hosts",
          patch,
          `WHERE user_id = $${Object.keys(patch).length + 1}`,
          [userId]
        );

        if (!upd)
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: "No valid updates provided.",
          });

        const { rows } = await app.db.query(upd.sql, upd.params);
        return reply.send({ host: rows[0] });
      } catch (e: any) {
        req.log.error({ err: e }, "PATCH /host/profile failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to update host profile.",
        });
      }
    }
  );

  /**
   * GET /api/host/cars
   */
  app.get(
    "/host/cars",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const q = (req.query ?? {}) as { limit?: string; offset?: string };
      const limit = clampInt(Number(q.limit ?? 20), 1, 100);
      const offset = clampInt(Number(q.offset ?? 0), 0, 1_000_000);

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const host = await getHostByUserId(app, userId);
        if (!host) return reply.code(404).send({ error: "HOST_NOT_FOUND" });

        const { rows } = await app.db.query(
          `
        SELECT *
        FROM cars
        WHERE host_user_id = $1
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT $2 OFFSET $3
        `,
          [userId, limit, offset]
        );

        const totalRes = await app.db.query(
          `
        SELECT COUNT(*)::int AS total
        FROM cars
        WHERE host_user_id = $1
          AND deleted_at IS NULL
        `,
          [userId]
        );

        return reply.send({
          items: rows,
          page: { limit, offset, total: totalRes.rows[0]?.total ?? 0 },
        });
      } catch (e: any) {
        req.log.error({ err: e }, "GET /host/cars failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to load host cars.",
        });
      }
    }
  );

  /**
   * POST /api/host/cars
   * Creates a draft car owned by host (host_user_id = users.id)
   */
  app.post(
    "/host/cars",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const host = await getHostByUserId(app, userId);
        if (!host) return reply.code(404).send({ error: "HOST_NOT_FOUND" });

        const patch = sanitizeCarCreate(req.body);

        if (
          !isNonEmptyString(patch.title) ||
          !isNonEmptyString(patch.vehicle_type) ||
          !isNonEmptyString(patch.transmission)
        ) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message:
              "title, vehicle_type, transmission are required to create a draft car.",
          });
        }

        const cols = ["host_user_id", ...Object.keys(patch)];
        const vals = [userId, ...Object.values(patch)];
        const placeholders = cols.map((_, i) => `$${i + 1}`);

        const { rows } = await app.db.query(
          `
        INSERT INTO cars (${cols.join(", ")})
        VALUES (${placeholders.join(", ")})
        RETURNING *
        `,
          vals
        );

        return reply.code(201).send({ car: rows[0] });
      } catch (e: any) {
        req.log.error({ err: e }, "POST /host/cars failed");
        return reply
          .code(500)
          .send({ error: "INTERNAL_ERROR", message: "Failed to create car." });
      }
    }
  );

  /**
   * PATCH /api/host/cars/:id
   * Updates host-owned car (does not allow status changes here)
   */
  app.patch(
    "/host/cars/:id",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId)
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const patch = sanitizeCarPatch(req.body);
        const keys = Object.keys(patch);
        if (keys.length === 0)
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: "No valid updates provided.",
          });

        const sets: string[] = [];
        const values: any[] = [];
        keys.forEach((k, i) => {
          sets.push(`${k} = $${i + 1}`);
          values.push(patch[k]);
        });
        sets.push(`updated_at = now()`);

        values.push(carId);
        values.push(userId);

        const { rows } = await app.db.query(
          `
        UPDATE cars
        SET ${sets.join(", ")}
        WHERE id = $${keys.length + 1}
          AND host_user_id = $${keys.length + 2}
          AND deleted_at IS NULL
        RETURNING *
        `,
          values
        );

        if (!rows[0])
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        return reply.send({ car: rows[0] });
      } catch (e: any) {
        req.log.error({ err: e }, "PATCH /host/cars/:id failed");
        return reply
          .code(500)
          .send({ error: "INTERNAL_ERROR", message: "Failed to update car." });
      }
    }
  );

  /**
   * POST /api/host/cars/:id/publish
   * Sets status to 'active' (DB constraint already requires host_user_id)
   * Optional gating: require host approved (commented)
   */
  app.post(
    "/host/cars/:id/publish",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId)
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        // Optional: only approved hosts can publish cars
        // const host = await getHostByUserId(app, userId);
        // if (!host) return reply.code(404).send({ error: "HOST_NOT_FOUND" });
        // if (host.status !== "approved") {
        //   return reply.code(403).send({ error: "HOST_NOT_APPROVED", message: "Host must be approved to publish cars." });
        // }

        const { rows } = await app.db.query(
          `
        UPDATE cars
        SET status = 'active'::car_status,
            updated_at = now()
        WHERE id = $1
          AND host_user_id = $2
          AND deleted_at IS NULL
        RETURNING *
        `,
          [carId, userId]
        );

        if (!rows[0])
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        return reply.send({ car: rows[0] });
      } catch (e: any) {
        req.log.error({ err: e }, "POST /host/cars/:id/publish failed");
        return reply
          .code(500)
          .send({ error: "INTERNAL_ERROR", message: "Failed to publish car." });
      }
    }
  );

  /**
   * POST /api/host/cars/:id/unpublish
   * Sets status back to 'draft'
   */
  app.post(
    "/host/cars/:id/unpublish",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId)
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const { rows } = await app.db.query(
          `
        UPDATE cars
        SET status = 'draft'::car_status,
            updated_at = now()
        WHERE id = $1
          AND host_user_id = $2
          AND deleted_at IS NULL
        RETURNING *
        `,
          [carId, userId]
        );

        if (!rows[0])
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        return reply.send({ car: rows[0] });
      } catch (e: any) {
        req.log.error({ err: e }, "POST /host/cars/:id/unpublish failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to unpublish car.",
        });
      }
    }
  );
  /**
   * * POST /api/host/cars/:id/photos/upload-url
   * Generates a signed upload URL for adding a car photo
   */
  app.post(
    "/host/cars/:id/photos/upload-url",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId) {
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });
      }

      const body = (req.body ?? {}) as {
        mimeType: string;
        fileName?: string;
      };

      const mimeType = String(body?.mimeType || "")
        .trim()
        .toLowerCase();
      const allowed = new Set([
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
      ]);
      if (!allowed.has(mimeType)) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "Only image/jpeg, image/png, image/webp are allowed.",
        });
      }

      const ext = mimeType.includes("png")
        ? "png"
        : mimeType.includes("webp")
        ? "webp"
        : "jpg";

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        // verify car belongs to this host user
        const { rows: carRows } = await app.db.query(
          `
          SELECT id, host_user_id, image_gallery
          FROM cars
          WHERE id = $1
            AND host_user_id = $2
            AND deleted_at IS NULL
          LIMIT 1
          `,
          [carId, userId]
        );
        const car = carRows[0];
        if (!car) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        }

        const photoId = crypto.randomUUID();
        const objectPath = `cars/${carId}/${photoId}.${ext}`;

        const file = gcsBucket.file(objectPath);

        const [uploadUrl] = await file.getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000, // 15 min
          contentType: mimeType,
        });

        return reply.send({
          uploadUrl,
          photo: {
            id: photoId,
            path: objectPath,
            mime: mimeType,
            url: gcsPublicUrl(objectPath), // if bucket private, still OK to store path; url may not be viewable
          },
        });
      } catch (e: any) {
        req.log.error({ err: e }, "upload-url failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to generate upload URL.",
        });
      }
    }
  );

  /**
   * POST /api/host/cars/:id/photos/finalize
   * Finalizes uploaded photos by adding them to the car's image_gallery
   */

  app.post(
    "/host/cars/:id/photos/finalize",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId) {
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });
      }

      const body = (req.body ?? {}) as {
        photos: Array<{
          id: string;
          path: string;
          url?: string;
          mime?: string;
          width?: number;
          height?: number;
        }>;
      };

      const photos = Array.isArray(body.photos) ? body.photos : [];
      const clean = photos
        .map((p) => ({
          id: typeof p?.id === "string" ? p.id : "",
          path: typeof p?.path === "string" ? p.path : "",
          url: typeof p?.url === "string" ? p.url : "",
          mime: typeof p?.mime === "string" ? p.mime : "",
          width: typeof p?.width === "number" ? p.width : undefined,
          height: typeof p?.height === "number" ? p.height : undefined,
          created_at: new Date().toISOString(),
        }))
        .filter((p) => p.id && p.path);

      if (clean.length === 0) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "photos[] is required",
        });
      }

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const { rows: carRows } = await app.db.query(
          `
          SELECT *
          FROM cars
          WHERE id = $1
            AND host_user_id = $2
            AND deleted_at IS NULL
          LIMIT 1
          `,
          [carId, userId]
        );
        const car = carRows[0];
        if (!car) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        }

        const existing = Array.isArray(car.image_gallery)
          ? car.image_gallery
          : [];

        // merge by id
        const map = new Map<string, any>();
        for (const item of existing) {
          if (item?.id) map.set(String(item.id), item);
        }
        for (const item of clean) {
          map.set(String(item.id), {
            ...item,
            url: item.url || gcsPublicUrl(item.path),
          });
        }

        const merged = Array.from(map.values());
        const hasImage = merged.length > 0;

        const { rows } = await app.db.query(
          `
          UPDATE cars
          SET image_gallery = $1::jsonb,
              has_image = $2,
              updated_at = now()
          WHERE id = $3
            AND host_user_id = $4
            AND deleted_at IS NULL
          RETURNING *
          `,
          [JSON.stringify(merged), hasImage, carId, userId]
        );

        return reply.send({ car: rows[0] });
      } catch (e: any) {
        req.log.error({ err: e }, "finalize failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to finalize photos.",
        });
      }
    }
  );
};

export default hostRoutes;

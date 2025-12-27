import type { FastifyPluginAsync } from "fastify";
import crypto from "crypto";
import { gcsBucket, gcsPublicUrl } from "../../lib/gcs.js";

/**
 * Host car routes (future-proof V1)
 *
 * Mounted with prefix "/api" in app.ts:
 *   /api/host/cars
 *   /api/host/cars/:id
 *   /api/host/cars/:id/publish
 *   /api/host/cars/:id/unpublish
 *   /api/host/cars/:id/photos/upload-url
 *   /api/host/cars/:id/photos/finalize
 */

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

  if (
    typeof body?.odometer_km === "number" &&
    Number.isFinite(body.odometer_km)
  ) {
    out.odometer_km = clampInt(Math.trunc(body.odometer_km), 1, 2_000_000);
  } else if (typeof body?.odometer_km === "string") {
    const n = Number(String(body.odometer_km).replace(/[^\d]/g, ""));
    if (Number.isFinite(n) && n > 0) {
      out.odometer_km = clampInt(Math.trunc(n), 1, 2_000_000);
    }
  }

  return out;
}

const hostCarsRoutes: FastifyPluginAsync = async (app) => {
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
   * GET /api/host/cars/:id
   * Loads a single host-owned car by id
   */
  app.get(
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

        const host = await getHostByUserId(app, userId);
        if (!host) return reply.code(404).send({ error: "HOST_NOT_FOUND" });

        const { rows } = await app.db.query(
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

        if (!rows[0]) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        }

        return reply.send({ car: rows[0] });
      } catch (e: any) {
        req.log.error({ err: e }, "GET /host/cars/:id failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to load car.",
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

        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: e?.detail || e?.message || "Failed to create car.",
        });
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
   * DELETE /api/host/cars/:id
   * Soft-deletes car row and deletes related images from GCS
   */
  app.delete(
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

        // Load car first so we can delete its images
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

        // Collect object paths to delete from GCS
        const paths = new Set<string>();

        const gallery = Array.isArray(car.image_gallery)
          ? car.image_gallery
          : [];
        for (const it of gallery) {
          const p =
            typeof it === "string"
              ? it
              : typeof it?.path === "string"
              ? String(it.path)
              : "";
          if (p) paths.add(p);
        }

        const imagePath =
          typeof car.image_path === "string" ? car.image_path : "";
        if (imagePath && !imagePath.startsWith("draft/")) {
          // if image_path stored as object path (cars/...)
          if (imagePath.startsWith("cars/")) paths.add(imagePath);
        }

        // Also delete EVERYTHING under cars/<carId>/ as a safety net
        // (covers any objects not present in DB json)
        await gcsBucket.deleteFiles({
          prefix: `cars/${carId}/`,
          force: true,
        });

        // Delete explicit paths too (harmless if already removed by prefix)
        for (const p of paths) {
          try {
            await gcsBucket.file(p).delete({ ignoreNotFound: true } as any);
          } catch {}
        }

        // Soft delete car row
        const { rows } = await app.db.query(
          `
          UPDATE cars
          SET deleted_at = now(),
              updated_at = now()
          WHERE id = $1
            AND host_user_id = $2
            AND deleted_at IS NULL
          RETURNING *
          `,
          [carId, userId]
        );

        return reply.send({ car: rows[0] });
      } catch (e: any) {
        req.log.error({ err: e }, "DELETE /host/cars/:id failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to delete car.",
        });
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
      if (!carId) {
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });
      }

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        // ✅ Transaction so car publish never "half succeeds"
        await app.db.query("BEGIN");

        // 1) Publish the car (your original logic)
        const carRes = await app.db.query(
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

        const car = carRes.rows[0];
        if (!car) {
          await app.db.query("ROLLBACK");
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        }

        // 2) Auto-approve host (fix: set approved_at + submitted_at)
        // NOTE: this assumes your DB has approved_at constraint when status='approved'
        const hostRes = await app.db.query(
          `
          UPDATE hosts
          SET status = 'approved'::host_status,
              approved_at = COALESCE(approved_at, now()),
              submitted_at = COALESCE(submitted_at, now()),
              updated_at = now()
          WHERE user_id = $1
          RETURNING *
          `,
          [userId]
        );

        // If no host row exists, we won't fail publishing the car — but you can choose to fail if you want.
        const host = hostRes.rows[0] ?? null;

        await app.db.query("COMMIT");
        return reply.send({ car, host });
      } catch (e: any) {
        try {
          await app.db.query("ROLLBACK");
        } catch {}

        req.log.error(
          {
            code: e?.code,
            table: e?.table,
            column: e?.column,
            constraint: e?.constraint,
            detail: e?.detail,
            message: e?.message,
          },
          "POST /host/cars/:id/publish failed"
        );

        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: e?.detail || e?.message || "Failed to publish car.",
        });
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

        // choose cover url (first photo)
        const coverUrl = hasImage
          ? String(merged[0]?.url || gcsPublicUrl(merged[0]?.path || "")).trim()
          : "draft/placeholder.jpg";

        const { rows } = await app.db.query(
          `
          UPDATE cars
          SET image_gallery = $1::jsonb,
              has_image = $2,
              image_path = $3,
              updated_at = now()
          WHERE id = $4
            AND host_user_id = $5
            AND deleted_at IS NULL
          RETURNING *
          `,
          [JSON.stringify(merged), hasImage, coverUrl, carId, userId]
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

export default hostCarsRoutes;

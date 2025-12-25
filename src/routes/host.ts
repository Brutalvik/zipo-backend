import type { FastifyPluginAsync } from "fastify";

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
};

export default hostRoutes;

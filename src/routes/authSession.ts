import type { FastifyPluginAsync } from "fastify";

// Conservative caps to prevent DB bloat / unexpected token payload sizes
const MAX_EMAIL = 320; // RFC-ish safe upper bound
const MAX_URL = 2048; // common URL max
const MAX_PROVIDER = 64;

function clampStr(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function getAuthContext(req: any): {
  uid: string;
  email: string | null;
  picture: string | null;
  provider: string | null;
  emailVerified: boolean;
} | null {
  // ✅ Preferred: set by app.authenticate
  const au = req.authUser as
    | {
        uid: string;
        email?: string;
        picture?: string;
        emailVerified?: boolean;
        claims?: any;
        raw?: any;
      }
    | undefined;

  if (au?.uid) {
    // provider might be in claims/raw depending on how you map it
    const provider =
      clampStr(au?.raw?.firebase?.sign_in_provider, MAX_PROVIDER) ??
      clampStr(au?.claims?.firebase?.sign_in_provider, MAX_PROVIDER) ??
      null;

    return {
      uid: String(au.uid),
      email: clampStr(au.email, MAX_EMAIL),
      picture: clampStr(au.picture, MAX_URL),
      provider,
      emailVerified: au.emailVerified === true,
    };
  }

  // ✅ Legacy fallback: if some route still sets req.user
  const u = req.user as any;
  if (u?.uid) {
    return {
      uid: String(u.uid),
      email: clampStr(u.email, MAX_EMAIL),
      picture: clampStr(u.picture, MAX_URL),
      provider: clampStr(u?.firebase?.sign_in_provider, MAX_PROVIDER),
      emailVerified: (u.email_verified ?? u.emailVerified) === true,
    };
  }

  return null;
}

const authSessionRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/auth/session  (because app.ts registers with prefix "/api")
   *
   * Purpose:
   * - Verify Firebase token (app.authenticate)
   * - Upsert user row in DB keyed by firebase_uid
   * - Update last_login_at
   * - Return canonical backend user record
   */
  app.post(
    "/auth/session",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const ctx = getAuthContext(req);

      if (!ctx) {
        return reply.code(401).send({
          error: "Unauthorized",
          message: "Invalid auth context",
        });
      }

      const q = `
        INSERT INTO users (firebase_uid, email, profile_photo_url, provider, email_verified, last_login_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (firebase_uid)
        DO UPDATE SET
          email = COALESCE(EXCLUDED.email, users.email),
          profile_photo_url = COALESCE(EXCLUDED.profile_photo_url, users.profile_photo_url),
          provider = COALESCE(EXCLUDED.provider, users.provider),
          email_verified = EXCLUDED.email_verified,
          last_login_at = now()
        RETURNING
          id, firebase_uid, email, full_name, date_of_birth, profile_photo_url,
          phone_e164, phone_verified, email_verified, mode, status, kyc_status,
          address, preferences, created_at, updated_at;
      `;

      try {
        const { rows } = await app.db.query(q, [
          ctx.uid,
          ctx.email,
          ctx.picture,
          ctx.provider,
          ctx.emailVerified,
        ]);

        return reply.send({ user: rows[0] });
      } catch (err) {
        app.log.error({ err }, "POST /auth/session db error");
        return reply.code(500).send({
          error: "Internal Server Error",
          message: "Failed to sync session",
        });
      }
    }
  );
};

export default authSessionRoutes;

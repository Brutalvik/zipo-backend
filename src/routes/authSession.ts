import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../middleware/requireAuth.js";

const authSessionRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/auth/session",
    { preHandler: requireAuth },
    async (req, reply) => {
      app.log.info("🔥 /api/auth/session HIT");
      // req.user comes from Firebase token
      const u = req.user as {
        uid: string;
        email?: string;
        picture?: string;
        firebase?: { sign_in_provider?: string };
        email_verified?: boolean;
      };

      const firebaseUid = u.uid;
      const email = u.email ?? null;
      const photo = u.picture ?? null;
      const provider = u.firebase?.sign_in_provider ?? null;
      const emailVerified = !!u.email_verified;

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

      const { rows } = await app.db.query(q, [
        firebaseUid,
        email,
        photo,
        provider,
        emailVerified,
      ]);

      return reply.send({ user: rows[0] });
    }
  );
};

export default authSessionRoutes;

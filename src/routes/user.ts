import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../middleware/requireAuth.js";

/**
 * User routes
 * All routes are scoped to the authenticated user via Firebase UID.
 * NO userId is ever passed from the client.
 */
const userRoutes: FastifyPluginAsync = async (app) => {
  /**
   * ----------------------------------------------------
   * GET /users/me
   * ----------------------------------------------------
   * Returns the current authenticated user from DB
   * Frontend uses this to refresh profile state
   */
  app.get("/users/me", { preHandler: requireAuth }, async (req, reply) => {
    const u = req.user as { uid: string };

    const { rows } = await app.db.query(
      `
      SELECT
        id,
        firebase_uid,
        email,
        full_name,
        profile_photo_url,
        phone_e164,
        phone_verified,
        email_verified,
        mode,
        status,
        kyc_status,
        address,
        preferences,
        created_at,
        updated_at
      FROM users
      WHERE firebase_uid = $1
      LIMIT 1
      `,
      [u.uid]
    );

    if (!rows[0]) {
      return reply.code(404).send({ error: "User not found" });
    }

    return reply.send({ user: rows[0] });
  });

  /**
   * ----------------------------------------------------
   * PATCH /users/phone
   * ----------------------------------------------------
   * Syncs phone verification state FROM Firebase Auth → DB
   * Firebase is the source of truth.
   */
  app.patch("/users/phone", { preHandler: requireAuth }, async (req, reply) => {
    const u = req.user as { uid: string };
    const body = (req.body ?? {}) as {
      phone_e164?: string;
      phone_verified?: boolean;
    };

    if (
      !body.phone_e164 ||
      typeof body.phone_e164 !== "string" ||
      !body.phone_e164.startsWith("+")
    ) {
      return reply.code(400).send({
        error: "phone_e164 must be a valid E.164 string (e.g. +14165551234)",
      });
    }

    const phone_verified = body.phone_verified === true;

    const { rows } = await app.db.query(
      `
      UPDATE users
      SET
        phone_e164 = $2,
        phone_verified = $3,
        updated_at = now()
      WHERE firebase_uid = $1
      RETURNING
        id,
        firebase_uid,
        email,
        full_name,
        profile_photo_url,
        phone_e164,
        phone_verified,
        email_verified,
        mode,
        status,
        kyc_status,
        address,
        preferences,
        created_at,
        updated_at
      `,
      [u.uid, body.phone_e164, phone_verified]
    );

    if (!rows[0]) {
      return reply.code(404).send({ error: "User not found" });
    }

    return reply.send({ user: rows[0] });
  });

  /**
   * ----------------------------------------------------
   * PATCH /users/phone/sync
   * ----------------------------------------------------
   * Sync phone FROM Firebase token → DB
   * Client sends nothing except Authorization header
   */
  app.patch(
    "/users/phone/sync",
    { preHandler: requireAuth },
    async (req, reply) => {
      const u = req.user as any;

      // Firebase ID token claim
      const phone =
        u.phone_number ?? u.phoneNumber ?? u.phone ?? u.phone_e164 ?? null;

      if (!phone) {
        return reply.code(400).send({
          error: "NO_FIREBASE_PHONE",
          message: "Firebase user has no verified phone number",
        });
      }

      const { rows } = await app.db.query(
        `
      UPDATE users
      SET
        phone_e164 = $2,
        phone_verified = true,
        updated_at = now()
      WHERE firebase_uid = $1
      RETURNING
        id,
        firebase_uid,
        email,
        full_name,
        profile_photo_url,
        phone_e164,
        phone_verified,
        email_verified,
        mode,
        status,
        kyc_status,
        address,
        preferences,
        created_at,
        updated_at
      `,
        [u.uid, String(phone)]
      );

      if (!rows[0]) {
        return reply.code(404).send({ error: "User not found" });
      }

      return reply.send({ user: rows[0] });
    }
  );
};

export default userRoutes;

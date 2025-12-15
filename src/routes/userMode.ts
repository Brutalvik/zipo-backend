import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../middleware/requireAuth.js";

const usersModeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/users/mode", { preHandler: requireAuth }, async (req, reply) => {
    const u = req.user as { uid: string };

    const { rows } = await app.db.query(
      `SELECT mode FROM users WHERE firebase_uid = $1 LIMIT 1`,
      [u.uid]
    );

    if (!rows[0]) return reply.code(404).send({ error: "User not found" });

    return reply.send({ mode: rows[0].mode });
  });

  app.patch("/users/mode", { preHandler: requireAuth }, async (req, reply) => {
    const u = req.user as { uid: string };
    const body = (req.body ?? {}) as { mode?: "guest" | "host" };

    if (body.mode !== "guest" && body.mode !== "host") {
      return reply.code(400).send({ error: "mode must be 'guest' or 'host'" });
    }

    const { rows } = await app.db.query(
      `
      UPDATE users
      SET mode = $2, updated_at = now()
      WHERE firebase_uid = $1
      RETURNING
        id, firebase_uid, email, full_name, profile_photo_url,
        phone_e164, phone_verified, email_verified, mode, status, kyc_status,
        address, preferences, created_at, updated_at;
      `,
      [u.uid, body.mode]
    );

    if (!rows[0]) return reply.code(404).send({ error: "User not found" });

    return reply.send({ user: rows[0] });
  });
};

export default usersModeRoutes;

import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../middleware/requireAuth.js";

const userModeRoutes: FastifyPluginAsync = async (app) => {
  app.patch(
    "/api/users/mode",
    { preHandler: requireAuth },
    async (req, reply) => {
      const u = req.user as { uid: string };
      const body = req.body as { mode?: "guest" | "host" } | undefined;

      const mode = body?.mode;

      if (mode !== "guest" && mode !== "host") {
        return reply
          .code(400)
          .send({ error: "mode must be 'guest' or 'host'" });
      }

      const { rows } = await app.db.query(
        `
        UPDATE users
        SET mode = $1, updated_at = now()
        WHERE firebase_uid = $2
        RETURNING
          id, firebase_uid, email, full_name, date_of_birth, profile_photo_url,
          phone_e164, phone_verified, email_verified, mode, status, kyc_status,
          address, preferences, created_at, updated_at;
        `,
        [mode, u.uid]
      );

      if (!rows[0]) {
        return reply.code(404).send({ error: "User not found" });
      }

      return reply.send({ user: rows[0] });
    }
  );
};

export default userModeRoutes;

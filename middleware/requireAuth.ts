import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Legacy middleware wrapper.
 *
 * ✅ Delegates to Fastify's `app.authenticate` (Firebase Admin verification).
 * ✅ Keeps old routes working by ensuring `(req as any).user` is still set
 *    (done inside app.authenticate).
 *
 * Once all routes use `{ preHandler: app.authenticate }`,
 * you can delete this file and remove imports.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const serverAny = req.server as any;

  if (typeof serverAny.authenticate === "function") {
    // app.authenticate sets req.authUser and also (req as any).user for legacy.
    return serverAny.authenticate(req, reply);
  }

  return reply.code(501).send({
    error: "AUTH_NOT_AVAILABLE",
    message: "Authentication is not configured on the server",
  });
}

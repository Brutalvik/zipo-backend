import { type FastifyRequest, type FastifyReply } from "fastify";
import { verifyIdToken } from "../lib/firebaseAdmin.js";

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) {
    return reply
      .code(401)
      .send({ error: "Missing Authorization Bearer token" });
  }

  try {
    const decoded = await verifyIdToken(token);

    // attach decoded token to request
    // @ts-ignore
    req.user = decoded;

    return;
  } catch (e) {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
}

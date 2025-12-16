import type { FastifyPluginAsync } from "fastify";
import { renderLoginHtml } from "../ui/login.html.js";

const loginRoutes: FastifyPluginAsync = async (app) => {
  app.get("/login", async (_req, reply) => {
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(renderLoginHtml());
  });
};

export default loginRoutes;

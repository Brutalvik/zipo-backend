import "dotenv/config";
import Fastify, { type FastifyInstance } from "fastify";
import dbPlugin from "./plugins/db.js";
import carsRoutes from "./routes/cars.js";
import homeRoutes from "./routes/home.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true, trustProxy: true });

  app.register(dbPlugin);
  app.register(homeRoutes);
  app.register(carsRoutes);

  return app;
}

// Local dev: start server explicitly (Windows + tsx friendly)
if (process.env.RUN_LOCAL === "true") {
  const server = buildApp();
  const port = parseInt(process.env.PORT || "8080", 10);

  server
    .listen({ port, host: "0.0.0.0" })
    .then((address) => console.log(`Fastify server listening at ${address}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

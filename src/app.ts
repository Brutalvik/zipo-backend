import "dotenv/config";
import Fastify, { type FastifyInstance } from "fastify";
import authPlugin from "./plugins/auth.js";
import dbPlugin from "./plugins/db.js";

//Routes
import loginRoutes from "./routes/login.js";
import authSessionRoutes from "./routes/authSession.js";
import homeRoutes from "./routes/home.js";
import carsRoutes from "./routes/cars.js";
import userModeRoutes from "./routes/userMode.js";
import userRoutes from "./routes/user.js";
import hostRoutes from "./routes/host.js";
import hostCarsRoutes from "./routes/hostCars.js";
import geocodeRoutes from "./routes/geocode.js";

// Application builder
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true, trustProxy: true });

  // Auth
  app.register(authPlugin);

  // Infra
  app.register(dbPlugin);

  // Routes
  app.register(loginRoutes);
  app.register(authSessionRoutes, { prefix: "/api" });
  app.register(homeRoutes);
  app.register(carsRoutes, { prefix: "/api" });
  app.register(userModeRoutes, { prefix: "/api" });
  app.register(userRoutes, { prefix: "/api" });
  app.register(hostRoutes, { prefix: "/api" });
  app.register(hostCarsRoutes, { prefix: "/api" });
  app.register(geocodeRoutes, { prefix: "/api" });

  return app;
}

// Local dev: start server explicitly (Windows + tsx friendly)
if (process.env.RUN_LOCAL === "true") {
  console.log("Starting fastify server ...");
  const server = buildApp();
  console.log("Bulding necessary functions...");
  const port = parseInt(process.env.PORT || "8080", 10);
  console.log("Assigning port 8080...");
  server
    .listen({ port, host: "0.0.0.0" })
    .then((address) => console.log(`Fastify server listening at ${address}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

import "dotenv/config";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import pg from "pg";

declare module "fastify" {
  interface FastifyInstance {
    db: pg.Pool;
  }
}

const dbPlugin: FastifyPluginAsync = async (app) => {
  const connectionString = process.env.DATABASE_URL;
  console.log("Using DATABASE_URL:", connectionString);
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const pool = new pg.Pool({
    connectionString,
    // important for serverless
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  app.decorate("db", pool);

  app.addHook("onClose", async () => {
    await pool.end();
  });
};

export default fp(dbPlugin);

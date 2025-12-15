// src/routes/home.ts
import type { FastifyPluginAsync } from "fastify";
import { renderGatewayHtml, type ApiEndpoint } from "../ui/gateway.html.js";

const ENDPOINTS: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/api/health",
    description: "Health check (DB + uptime)",
  },
  {
    method: "GET",
    path: "/api/cars",
    description: "List cars (filters + pagination)",
  },
  { method: "GET", path: "/api/cars/:id", description: "Car details" },
  {
    method: "GET",
    path: "/api/cars/filters",
    description: "Filter options (UI helper)",
  },
  {
    method: "GET",
    path: "/api/cars/search/suggest",
    description: "Typeahead suggestions",
  },
  { method: "GET", path: "/api/cars/:id/similar", description: "Similar cars" },
  {
    method: "GET",
    path: "/api/cars/:id/availability",
    description: "Availability (stub for now)",
  },
  {
    method: "GET",
    path: "/api/cars/featured",
    description: "Featured cars (home section)",
  },
];

const homeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/health", async (_req, reply) => {
    const start = Date.now();

    let connected = false;
    let latencyMs: number | null = null;
    let error: string | null = null;

    try {
      await app.db.query("SELECT 1");
      connected = true;
      latencyMs = Date.now() - start;
    } catch (e: any) {
      connected = false;
      latencyMs = null;
      error = e?.message ?? "Unknown DB error";
    }

    return reply.send({
      ok: connected,
      service: "zipo-api-gateway",
      uptimeSec: Math.floor(process.uptime()),
      now: new Date().toISOString(),
      db: { connected, latencyMs, error },
    });
  });

  app.get("/", async (_req, reply) => {
    const start = Date.now();
    let connected = false;
    let latencyMs: number | null = null;

    try {
      await app.db.query("SELECT 1");
      connected = true;
      latencyMs = Date.now() - start;
    } catch {
      connected = false;
      latencyMs = null;
    }

    const html = renderGatewayHtml({
      dbConnected: connected,
      dbLatencyMs: latencyMs,
      version: process.env.APP_VERSION ?? "dev",
      endpoints: ENDPOINTS,
      nowIso: new Date().toISOString(),
    });

    reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(html);
  });
};

export default homeRoutes;

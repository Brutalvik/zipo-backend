// src/routes/home.ts
import "dotenv/config";
import type { FastifyPluginAsync } from "fastify";
import { renderGatewayHtml, type ApiEndpoint } from "../ui/gateway.html.js";
import { renderAccessDeniedHtml } from "../ui/accessDenied.html.js";

function parseEmailSet(value?: string) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

const ALLOWED_EMAILS = parseEmailSet(process.env.AUTH_ALLOWED_EMAILS);
const ADMIN_EMAILS = parseEmailSet(process.env.AUTH_ADMIN_EMAILS);
const ENDPOINTS: ApiEndpoint[] = [
  // -------------------------
  // System
  // -------------------------
  {
    method: "GET",
    path: "/api/health",
    description: "Health check (DB connectivity + uptime)",
  },

  // -------------------------
  // Cars / Marketplace
  // -------------------------
  {
    method: "GET",
    path: "/api/cars",
    description: "List cars (filters + pagination)",
  },
  {
    method: "GET",
    path: "/api/cars/:id",
    description: "Car details",
  },
  {
    method: "GET",
    path: "/api/cars/filters",
    description: "Car filter options (UI helper)",
  },
  {
    method: "GET",
    path: "/api/cars/search/suggest",
    description: "Search typeahead suggestions",
  },
  {
    method: "GET",
    path: "/api/cars/:id/similar",
    description: "Similar cars",
  },
  {
    method: "GET",
    path: "/api/cars/:id/availability",
    description: "Car availability (stub)",
  },
  {
    method: "GET",
    path: "/api/cars/featured",
    description: "Featured cars (home screen)",
  },

  // -------------------------
  // Home
  // -------------------------
  {
    method: "GET",
    path: "/api/home",
    description: "Home screen content (featured sections, promos)",
  },

  // -------------------------
  // Auth / Session
  // -------------------------
  {
    method: "GET",
    path: "/api/auth/session",
    description: "Validate auth session (Firebase token → backend)",
  },

  // -------------------------
  // User / Profile
  // -------------------------
  {
    method: "GET",
    path: "/api/users/me",
    description: "Get current user profile",
  },
  {
    method: "PATCH",
    path: "/api/users/profile",
    description:
      "Update user profile (name, DOB, photo; immutability enforced)",
  },
  {
    method: "PATCH",
    path: "/api/users/phone",
    description: "Update phone number (pending verification model)",
  },
  {
    method: "PATCH",
    path: "/api/users/email/sync",
    description: "Sync verified email from Firebase to backend",
  },
  {
    method: "GET",
    path: "/api/users/mode",
    description: "Get current user mode (Guest / Host)",
  },
  {
    method: "PATCH",
    path: "/api/users/mode",
    description: "Switch user mode (Guest / Host)",
  },

  // -------------------------
  // Bookings (partial)
  // -------------------------
  {
    method: "POST",
    path: "/api/bookings",
    description: "Create booking (DOB required, 18+ enforced)",
  },
  {
    method: "GET",
    path: "/api/bookings/me",
    description: "Get current user's bookings",
  },
];

const homeRoutes: FastifyPluginAsync = async (app) => {
  // JSON health (used by UI)
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

  // Protect the Gateway UI
  app.get("/", { preHandler: app.requireUiAuth }, async (req, reply) => {
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

    const user = (req as any).session?.user;

    // Safety check (should not happen because of requireUiAuth)
    if (!user?.email) {
      return reply.redirect("/login");
    }

    const email = String(user.email).toLowerCase();

    // ❌ NOT ALLOWED → ACCESS DENIED
    if (!ALLOWED_EMAILS.has(email)) {
      return reply
        .code(403)
        .header("content-type", "text/html; charset=utf-8")
        .header("cache-control", "no-store")
        .send(
          renderAccessDeniedHtml({
            email,
            name: user.name,
            picture: user.picture,
          })
        );
    }

    // ✅ ALLOWED → GATEWAY
    const html = renderGatewayHtml({
      dbConnected: connected,
      dbLatencyMs: latencyMs,
      version: process.env.APP_VERSION ?? "dev",
      endpoints: ENDPOINTS,
      nowIso: new Date().toISOString(),
      user: {
        name: user.name ?? "",
        email,
        picture: user.picture ?? "",
        role: ADMIN_EMAILS.has(email) ? "admin" : "user",
      },
    });

    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(html);
  });
};

export default homeRoutes;

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

/**
 * Access policy:
 * - If AUTH_ALLOWED_EMAILS is provided: only those emails can access Gateway UI.
 * - If AUTH_ALLOWED_EMAILS is empty: only admins can access (safe default).
 * - If both are empty: deny all (safe default).
 */
function canAccessGateway(email: string) {
  const e = email.toLowerCase();
  if (ALLOWED_EMAILS.size > 0) return ALLOWED_EMAILS.has(e);
  if (ADMIN_EMAILS.size > 0) return ADMIN_EMAILS.has(e);
  return false;
}

/**
 * IMPORTANT:
 * This list is for the Gateway UI display only.
 * Keep it aligned with what is ACTUALLY implemented in the backend.
 */
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
  // Auth / Session
  // -------------------------
  {
    method: "POST",
    path: "/api/auth/session",
    description: "Sync Firebase user to backend DB (Bearer token required)",
  },

  // -------------------------
  // Cars / Marketplace (public read)
  // -------------------------
  {
    method: "GET",
    path: "/api/cars",
    description: "List cars (filters + pagination)",
  },
  {
    method: "GET",
    path: "/api/cars/map",
    description: "Map viewport search (minLat/maxLat/minLng/maxLng)",
  },
  {
    method: "GET",
    path: "/api/cars/filters",
    description: "Filter dropdown options (distinct values)",
  },
  {
    method: "GET",
    path: "/api/cars/search",
    description: "Search cars (filters + pagination; q encouraged)",
  },
  {
    method: "GET",
    path: "/api/cars/search/suggest",
    description: "Typeahead suggestions (q required)",
  },
  {
    method: "GET",
    path: "/api/cars/featured",
    description: "Featured cars (home screen sections)",
  },
  {
    method: "GET",
    path: "/api/cars/popular",
    description: "Popular cars",
  },
  {
    method: "GET",
    path: "/api/cars/stats",
    description: "Car aggregates (debug / dashboards)",
  },
  {
    method: "GET",
    path: "/api/cars/:id",
    description: "Car details",
  },
  {
    method: "GET",
    path: "/api/cars/:id/similar",
    description: "Similar cars",
  },
  {
    method: "GET",
    path: "/api/cars/:id/availability",
    description: "Availability (stub until bookings exist)",
  },

  // -------------------------
  // Cars / Marketplace (protected write)
  // -------------------------
  {
    method: "POST",
    path: "/api/cars",
    description: "Create car (auth required)",
  },
  {
    method: "PATCH",
    path: "/api/cars/:id",
    description: "Update car (auth required)",
  },
  {
    method: "PATCH",
    path: "/api/cars/:id/publish",
    description: "Publish/unpublish status (auth required)",
  },
  {
    method: "DELETE",
    path: "/api/cars/:id",
    description: "Soft delete car (auth required)",
  },

  // -------------------------
  // User / Profile (auth required)
  // -------------------------
  {
    method: "GET",
    path: "/api/users/me",
    description: "Get current user profile",
  },
  {
    method: "PATCH",
    path: "/api/users/me",
    description:
      "Update current user profile (name/DOB/email/phone pending rules)",
  },
  {
    method: "PATCH",
    path: "/api/users/email/sync",
    description: "Sync email + email_verified from Firebase token",
  },
  {
    method: "PATCH",
    path: "/api/users/phone/sync",
    description: "Sync VERIFIED phone from Firebase token",
  },

  // NOTE:
  // If you want /api/users/mode or /api/home etc, only add them here
  // AFTER the routes actually exist in code.
];

const homeRoutes: FastifyPluginAsync = async (app) => {
  // JSON health (used by UI + debugging)
  app.get("/api/health", async (_req, reply) => {
    const start = Date.now();

    let connected = false;
    let latencyMs: number | null = null;
    let error: string | null = null;

    try {
      await app.db.query("SELECT 1");
      connected = true;
      latencyMs = Date.now() - start;
    } catch (e: unknown) {
      connected = false;
      latencyMs = null;
      error = e instanceof Error ? e.message : "Unknown DB error";
    }

    return reply.send({
      ok: connected,
      service: "zipo-api-gateway",
      uptimeSec: Math.floor(process.uptime()),
      now: new Date().toISOString(),
      db: { connected, latencyMs, error },
    });
  });

  // Protect the Gateway UI (HTML)
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

    // Safety check (should not happen due to requireUiAuth)
    if (!user?.email) {
      return reply.redirect("/login");
    }

    const email = String(user.email).toLowerCase();

    // ❌ NOT ALLOWED → ACCESS DENIED
    if (!canAccessGateway(email)) {
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

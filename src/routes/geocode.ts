import type { FastifyPluginAsync } from "fastify";

/**
 * Geocode route
 * POST /api/geocode
 *
 * Requires auth:
 *   Authorization: Bearer <Firebase ID token>
 *
 * Body:
 *   { address: string }
 *
 * Response:
 *   { lat: number, lng: number, formatted_address?: string }
 */

function getAuth(req: any): { uid: string; raw: any } | null {
  if (req.authUser?.uid) return { uid: req.authUser.uid, raw: req.authUser };
  return null;
}

type GeocodeBody = {
  address?: string;
};

const geocodeRoutes: FastifyPluginAsync = async (app) => {
  app.post("/geocode", { preHandler: app.authenticate }, async (req, reply) => {
    const auth = getAuth(req);
    if (!auth) return reply.code(401).send({ error: "Unauthorized" });

    try {
      const body = (req.body ?? {}) as GeocodeBody;
      const address = String(body.address ?? "").trim();

      if (!address || address.length < 6) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "address is required",
        });
      }

      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        return reply.code(500).send({
          error: "CONFIG_ERROR",
          message: "GOOGLE_MAPS_API_KEY is not set",
        });
      }

      const url =
        "https://maps.googleapis.com/maps/api/geocode/json" +
        `?address=${encodeURIComponent(address)}` +
        `&key=${encodeURIComponent(apiKey)}`;

      const r = await fetch(url);
      const data: any = await r.json().catch(() => ({}));

      // Google API can return 200 with status != OK, so check both
      const status = String(data?.status ?? "");
      if (!r.ok || status !== "OK") {
        return reply.code(422).send({
          error: "GEOCODE_FAILED",
          message:
            status === "ZERO_RESULTS"
              ? "No results for that address"
              : "Geocode failed",
          status,
          // keep raw minimal (but useful) for debugging
          error_message: data?.error_message ?? undefined,
        });
      }

      const loc = data?.results?.[0]?.geometry?.location;
      const lat = Number(loc?.lat);
      const lng = Number(loc?.lng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return reply.code(422).send({
          error: "GEOCODE_FAILED",
          message: "Invalid geocode response",
        });
      }

      return reply.send({
        lat,
        lng,
        formatted_address:
          typeof data?.results?.[0]?.formatted_address === "string"
            ? data.results[0].formatted_address
            : undefined,
      });
    } catch (e: any) {
      req.log.error({ err: e }, "POST /geocode failed");
      return reply.code(500).send({
        error: "INTERNAL_ERROR",
        message: "Failed to geocode address.",
      });
    }
  });
};

export default geocodeRoutes;

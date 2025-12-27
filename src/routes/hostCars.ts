import type { FastifyPluginAsync } from "fastify";
import crypto from "crypto";
import { gcsBucket, gcsPublicUrl } from "../../lib/gcs.js";

/**
 * Host car routes (V1)
 *
 * Mounted with prefix "/api" in app.ts:
 *   /api/host/cars
 *   /api/host/cars/:id
 *   /api/host/cars/:id/publish
 *   /api/host/cars/:id/unpublish
 *   /api/host/cars/:id/photos/upload-url
 *   /api/host/cars/:id/photos/finalize
 */

function getAuth(req: any): { uid: string; raw: any } | null {
  if (req.authUser?.uid)
    return { uid: String(req.authUser.uid), raw: req.authUser };
  const legacy = req.user;
  if (legacy?.uid) return { uid: String(legacy.uid), raw: legacy };
  return null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isPlainObject(v: any) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function cleanTextOrNull(v: any): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function cleanTextKeepEmpty(v: any): string | undefined {
  // for required text fields we allow empty string if client sends it
  if (typeof v !== "string") return undefined;
  return v.trim();
}

function parseNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseIntLike(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const digits = String(v).replace(/[^\d-]/g, "");
    if (!digits) return null;
    const n = Number(digits);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function parseLat(v: any): number | null {
  const n = parseNumber(v);
  if (n === null) return null;
  if (n < -90 || n > 90) return null;
  return n;
}

function parseLng(v: any): number | null {
  const n = parseNumber(v);
  if (n === null) return null;
  if (n < -180 || n > 180) return null;
  return n;
}

function safeJsonParse(v: any, fallback: any) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return fallback;
    try {
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Extract pickup fields from either:
 *  - top-level body.pickup_lat / pickup_lng / pickup_address
 *  - or features.pickup.pickup_lat / pickup_lng / pickup_address (and other pickup_* fields)
 */
function extractPickupPatch(body: any) {
  const out: Record<string, any> = {};

  // 1) top-level
  const topLat = parseLat(body?.pickup_lat);
  const topLng = parseLng(body?.pickup_lng);
  const topAddr = cleanTextOrNull(body?.pickup_address);
  const topCity = cleanTextOrNull(body?.pickup_city);
  const topState = cleanTextOrNull(body?.pickup_state);
  const topCountry = cleanTextOrNull(body?.pickup_country);
  const topPostal = cleanTextOrNull(body?.pickup_postal_code);

  // 2) nested features.pickup
  const pickupObj = body?.features?.pickup;
  const nestedLat =
    pickupObj && isPlainObject(pickupObj)
      ? parseLat((pickupObj as any).pickup_lat)
      : null;
  const nestedLng =
    pickupObj && isPlainObject(pickupObj)
      ? parseLng((pickupObj as any).pickup_lng)
      : null;
  const nestedAddr =
    pickupObj && isPlainObject(pickupObj)
      ? cleanTextOrNull((pickupObj as any).pickup_address)
      : null;

  const nestedCity =
    pickupObj && isPlainObject(pickupObj)
      ? cleanTextOrNull((pickupObj as any).pickup_city)
      : null;
  const nestedState =
    pickupObj && isPlainObject(pickupObj)
      ? cleanTextOrNull((pickupObj as any).pickup_state)
      : null;
  const nestedCountry =
    pickupObj && isPlainObject(pickupObj)
      ? cleanTextOrNull((pickupObj as any).pickup_country)
      : null;
  const nestedPostal =
    pickupObj && isPlainObject(pickupObj)
      ? cleanTextOrNull((pickupObj as any).pickup_postal_code)
      : null;

  // Prefer top-level if provided; else fallback to nested
  const lat = topLat ?? nestedLat;
  const lng = topLng ?? nestedLng;
  const addr = topAddr ?? nestedAddr;
  const city = topCity ?? nestedCity;
  const state = topState ?? nestedState;
  const country = topCountry ?? nestedCountry;
  const postal = topPostal ?? nestedPostal;

  if (lat !== null) out.pickup_lat = lat;
  if (lng !== null) out.pickup_lng = lng;
  if (addr !== null) out.pickup_address = addr;

  if (city !== null) out.pickup_city = city;
  if (state !== null) out.pickup_state = state;
  if (country !== null) out.pickup_country = country;
  if (postal !== null) out.pickup_postal_code = postal;

  return out;
}

function pickString(v: any): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function pickInt(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * Denormalize fields from either:
 * - top-level request body (preferred)
 * - OR body.features.* (fallback)
 *
 * This guarantees real columns get updated correctly.
 */
function denormCarColumnsFromBody(body: any) {
  const features = safeJsonParse(body?.features, {});
  const vehicle = safeJsonParse(features?.vehicle, {});
  const address = safeJsonParse(features?.address, {});
  const pickup = safeJsonParse(features?.pickup, {});

  // NOTE: "body_type" is its own column; do NOT confuse with "vehicle_type"
  const bodyType =
    pickString(body?.body_type) ?? pickString(vehicle?.body_type) ?? null;

  return {
    make: pickString(body?.make) ?? pickString(vehicle?.make) ?? null,
    model: pickString(body?.model) ?? pickString(vehicle?.model) ?? null,
    trim: pickString(body?.trim) ?? pickString(vehicle?.trim) ?? null,
    year: pickInt(body?.year) ?? pickInt(vehicle?.year) ?? null,

    body_type: bodyType ?? null,
    fuel_type:
      pickString(body?.fuel_type) ?? pickString(vehicle?.fuel_type) ?? null,

    pickup_city:
      pickString(body?.pickup_city) ??
      pickString(pickup?.pickup_city) ??
      pickString(address?.city) ??
      pickString(body?.city) ??
      null,

    pickup_state:
      pickString(body?.pickup_state) ??
      pickString(pickup?.pickup_state) ??
      pickString(address?.province) ??
      pickString(body?.area) ??
      pickString(body?.province) ??
      null,

    pickup_country:
      pickString(body?.pickup_country) ??
      pickString(pickup?.pickup_country) ??
      pickString(address?.country_code) ??
      pickString(body?.country_code) ??
      null,

    pickup_postal_code:
      pickString(body?.pickup_postal_code) ??
      pickString(pickup?.pickup_postal_code) ??
      pickString(address?.postal_code) ??
      null,
  };
}

/**
 * IMPORTANT:
 * Your DB has broken defaults ("" for numeric columns).
 * So sanitize must accept BOTH number and numeric-string for numeric fields.
 */
function sanitizeCarCreate(body: any) {
  const out: Record<string, any> = {};

  // required-ish for create
  if (isNonEmptyString(body?.title)) out.title = body.title.trim();
  if (isNonEmptyString(body?.vehicle_type))
    out.vehicle_type = body.vehicle_type.trim();
  if (isNonEmptyString(body?.transmission))
    out.transmission = body.transmission.trim();

  // ints (accept numeric strings)
  const seats = parseIntLike(body?.seats);
  if (seats !== null) out.seats = clampInt(seats, 1, 99);

  const ppd = parseIntLike(body?.price_per_day);
  if (ppd !== null) out.price_per_day = clampInt(ppd, 0, 1_000_000);

  // location text
  if (typeof body?.country_code === "string")
    out.country_code = body.country_code.trim().toUpperCase();
  if (typeof body?.city === "string") out.city = body.city.trim();
  if (typeof body?.area === "string") out.area = body.area.trim() || null;
  if (typeof body?.full_address === "string")
    out.full_address = body.full_address.trim();

  // ✅ pickup fields (top-level or nested)
  Object.assign(out, extractPickupPatch(body));

  // images
  if (typeof body?.image_path === "string")
    out.image_path = body.image_path.trim();
  if (typeof body?.image_public === "boolean")
    out.image_public = body.image_public;
  if (typeof body?.has_image === "boolean") out.has_image = body.has_image;

  if (typeof body?.is_popular === "boolean") out.is_popular = body.is_popular;
  if (typeof body?.is_featured === "boolean")
    out.is_featured = body.is_featured;

  // jsonb
  if (body?.image_gallery && Array.isArray(body.image_gallery))
    out.image_gallery = body.image_gallery;

  // Allow features save BUT we will not rely on it for pickup coords anymore.
  if (body?.features && isPlainObject(body.features))
    out.features = body.features;
  if (body?.requirements && isPlainObject(body.requirements))
    out.requirements = body.requirements;
  if (body?.pricing_rules && isPlainObject(body.pricing_rules))
    out.pricing_rules = body.pricing_rules;

  // ✅ NEW: denorm core columns from features.vehicle/address/pickup on create too
  const denorm = denormCarColumnsFromBody(body);
  if (denorm.make) out.make = denorm.make;
  if (denorm.model) out.model = denorm.model;
  if (denorm.trim) out.trim = denorm.trim;
  if (denorm.year != null) out.year = clampInt(denorm.year, 1900, 2100);
  if (denorm.body_type) out.body_type = denorm.body_type;
  if (denorm.fuel_type) out.fuel_type = denorm.fuel_type;

  // pickup_* fallbacks if not already set by extractPickupPatch
  if (out.pickup_city === undefined && denorm.pickup_city)
    out.pickup_city = denorm.pickup_city;
  if (out.pickup_state === undefined && denorm.pickup_state)
    out.pickup_state = denorm.pickup_state;
  if (out.pickup_country === undefined && denorm.pickup_country)
    out.pickup_country = denorm.pickup_country;
  if (out.pickup_postal_code === undefined && denorm.pickup_postal_code)
    out.pickup_postal_code = denorm.pickup_postal_code;

  return out;
}

function sanitizeCarPatch(body: any) {
  const out: Record<string, any> = {};

  // text (allow empty if client explicitly sends empty strings)
  const title = cleanTextKeepEmpty(body?.title);
  if (title !== undefined) out.title = title;

  const vt = cleanTextKeepEmpty(body?.vehicle_type);
  if (vt !== undefined) out.vehicle_type = vt;

  const tr = cleanTextKeepEmpty(body?.transmission);
  if (tr !== undefined) out.transmission = tr;

  // ints (accept numeric strings)
  const seats = parseIntLike(body?.seats);
  if (seats !== null) out.seats = clampInt(seats, 1, 99);

  const ppd = parseIntLike(body?.price_per_day);
  if (ppd !== null) out.price_per_day = clampInt(ppd, 0, 1_000_000);

  const year = parseIntLike(body?.year);
  if (year !== null) out.year = clampInt(year, 1900, 2100);

  const doors = parseIntLike(body?.doors);
  if (doors !== null) out.doors = clampInt(doors, 1, 10);

  const ev = parseIntLike(body?.ev_range_km);
  if (ev !== null) out.ev_range_km = clampInt(ev, 0, 2_000);

  const odo = parseIntLike(body?.odometer_km);
  if (odo !== null) out.odometer_km = clampInt(odo, 0, 2_000_000);

  // numeric (accept numeric strings)
  const pph = parseNumber(body?.price_per_hour);
  if (pph !== null) out.price_per_hour = pph;

  const dep = parseNumber(body?.deposit_amount);
  if (dep !== null) out.deposit_amount = dep;

  // country/city/address text
  if (typeof body?.country_code === "string")
    out.country_code = body.country_code.trim().toUpperCase();
  if (typeof body?.city === "string") out.city = body.city.trim();
  if (typeof body?.area === "string") out.area = body.area.trim() || null;
  if (typeof body?.full_address === "string")
    out.full_address = body.full_address.trim();

  // ✅ pickup fields (top-level or nested)
  Object.assign(out, extractPickupPatch(body));

  // car meta text (top-level)
  const make = cleanTextOrNull(body?.make);
  if (make !== null) out.make = make;

  const model = cleanTextOrNull(body?.model);
  if (model !== null) out.model = model;

  const trim = cleanTextOrNull(body?.trim);
  if (trim !== null) out.trim = trim;

  // NEW: body_type + fuel_type (top-level)
  const bodyType = cleanTextOrNull(body?.body_type);
  if (bodyType !== null) out.body_type = bodyType;

  const fuelType = cleanTextOrNull(body?.fuel_type);
  if (fuelType !== null) out.fuel_type = fuelType;

  // flags
  if (typeof body?.image_path === "string")
    out.image_path = body.image_path.trim();
  if (typeof body?.image_public === "boolean")
    out.image_public = body.image_public;
  if (typeof body?.has_image === "boolean") out.has_image = body.has_image;

  if (typeof body?.is_popular === "boolean") out.is_popular = body.is_popular;
  if (typeof body?.is_featured === "boolean")
    out.is_featured = body.is_featured;

  // jsonb
  if (body?.image_gallery && Array.isArray(body.image_gallery))
    out.image_gallery = body.image_gallery;

  // Allow features save BUT do not depend on it for pickup columns
  if (body?.features && isPlainObject(body.features))
    out.features = body.features;
  if (body?.requirements && isPlainObject(body.requirements))
    out.requirements = body.requirements;
  if (body?.pricing_rules && isPlainObject(body.pricing_rules))
    out.pricing_rules = body.pricing_rules;

  // ✅ NEW: denorm from features.* as fallback (this is what fixes your blanks)
  const denorm = denormCarColumnsFromBody(body);

  // only apply fallback if the top-level field wasn't provided in patch
  if (out.make === undefined && denorm.make) out.make = denorm.make;
  if (out.model === undefined && denorm.model) out.model = denorm.model;
  if (out.trim === undefined && denorm.trim) out.trim = denorm.trim;
  if (out.year === undefined && denorm.year != null)
    out.year = clampInt(denorm.year, 1900, 2100);
  if (out.body_type === undefined && denorm.body_type)
    out.body_type = denorm.body_type;
  if (out.fuel_type === undefined && denorm.fuel_type)
    out.fuel_type = denorm.fuel_type;

  if (out.pickup_city === undefined && denorm.pickup_city)
    out.pickup_city = denorm.pickup_city;
  if (out.pickup_state === undefined && denorm.pickup_state)
    out.pickup_state = denorm.pickup_state;
  if (out.pickup_country === undefined && denorm.pickup_country)
    out.pickup_country = denorm.pickup_country;
  if (out.pickup_postal_code === undefined && denorm.pickup_postal_code)
    out.pickup_postal_code = denorm.pickup_postal_code;

  return out;
}

async function getDbUserIdByFirebaseUid(
  app: any,
  firebaseUid: string
): Promise<string | null> {
  const { rows } = await app.db.query(
    `
    SELECT id
    FROM users
    WHERE firebase_uid = $1
    LIMIT 1
    `,
    [firebaseUid]
  );
  return rows[0]?.id ?? null;
}

async function getHostByUserId(app: any, userId: string) {
  const { rows } = await app.db.query(
    `
    SELECT *
    FROM hosts
    WHERE user_id = $1
    LIMIT 1
    `,
    [userId]
  );
  return rows[0] ?? null;
}

function buildUpdateSql(patch: Record<string, any>) {
  const keys = Object.keys(patch);
  const sets: string[] = [];
  const values: any[] = [];

  // columns that are jsonb in your cars table
  const JSONB_COLS = new Set([
    "features",
    "requirements",
    "pricing_rules",
    "image_gallery",
  ]);

  keys.forEach((k, idx) => {
    const v = patch[k];

    if (JSONB_COLS.has(k)) {
      sets.push(`${k} = $${idx + 1}::jsonb`);
      values.push(JSON.stringify(v ?? (k === "image_gallery" ? [] : {})));
      return;
    }

    sets.push(`${k} = $${idx + 1}`);
    values.push(v);
  });

  // always bump updated_at
  sets.push(`updated_at = now()`);

  return { keys, sets, values };
}

// keep list response consistent + typed + no empty-string lies
function normalizeCarRow(row: any) {
  const features = safeJsonParse(row?.features, {});
  const requirements = safeJsonParse(row?.requirements, {});
  const pricing_rules = safeJsonParse(row?.pricing_rules, {});
  const image_gallery = safeJsonParse(row?.image_gallery, []);

  return {
    ...row,
    features,
    requirements,
    pricing_rules,
    image_gallery,
  };
}

const hostCarsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/host/cars
   * ✅ Change: do NOT SELECT *
   * ✅ Change: return correct types AND fallback to JSON for make/model/year/pickup_* when columns are empty
   */
  app.get(
    "/host/cars",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const q = (req.query ?? {}) as { limit?: string; offset?: string };
      const limit = clampInt(Number(q.limit ?? 20), 1, 100);
      const offset = clampInt(Number(q.offset ?? 0), 0, 1_000_000);

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const host = await getHostByUserId(app, userId);
        if (!host) return reply.code(404).send({ error: "HOST_NOT_FOUND" });

        const { rows } = await app.db.query(
          `
          SELECT
            id,
            host_user_id,
            title,
            status,
            vehicle_type,
            transmission,
            seats::int AS seats,
            price_per_day::int AS price_per_day,
            price_per_hour,
            currency,
            country_code,
            city,
            area,
            full_address,

            pickup_lat,
            pickup_lng,
            pickup_address,

            -- IMPORTANT: treat "" as NULL, and fallback to features JSON
            COALESCE(NULLIF(make, ''),  features->'vehicle'->>'make') AS make,
            COALESCE(NULLIF(model,''),  features->'vehicle'->>'model') AS model,
            COALESCE(NULLIF(trim, ''),  features->'vehicle'->>'trim') AS trim,

            COALESCE(
              year,
              NULLIF((features->'vehicle'->>'year')::int, 0)
            ) AS year,

            COALESCE(NULLIF(body_type::text, ''), features->'vehicle'->>'body_type') AS body_type,
            COALESCE(NULLIF(fuel_type::text, ''), features->'vehicle'->>'fuel_type') AS fuel_type,

            doors,
            ev_range_km,
            odometer_km,

            image_path,
            image_public,
            has_image,
            image_gallery,

            is_popular,
            is_featured,

            COALESCE(NULLIF(pickup_city,''),        features->'pickup'->>'pickup_city')        AS pickup_city,
            COALESCE(NULLIF(pickup_state,''),       features->'pickup'->>'pickup_state')       AS pickup_state,
            COALESCE(NULLIF(pickup_country,''),     features->'pickup'->>'pickup_country')     AS pickup_country,
            COALESCE(NULLIF(pickup_postal_code,''), features->'pickup'->>'pickup_postal_code') AS pickup_postal_code,

            features,
            requirements,
            pricing_rules,

            created_at,
            updated_at,
            deleted_at
          FROM cars
          WHERE host_user_id = $1
            AND deleted_at IS NULL
          ORDER BY updated_at DESC
          LIMIT $2 OFFSET $3
          `,
          [userId, limit, offset]
        );

        const totalRes = await app.db.query(
          `
          SELECT COUNT(*)::int AS total
          FROM cars
          WHERE host_user_id = $1
            AND deleted_at IS NULL
          `,
          [userId]
        );

        return reply.send({
          items: rows.map(normalizeCarRow),
          page: { limit, offset, total: totalRes.rows[0]?.total ?? 0 },
        });
      } catch (e: any) {
        req.log.error({ err: e }, "GET /host/cars failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to load host cars.",
        });
      }
    }
  );

  /**
   * GET /api/host/cars/:id
   * ✅ Change: same typed + fallback fields so details screen is consistent
   */
  app.get(
    "/host/cars/:id",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId)
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const host = await getHostByUserId(app, userId);
        if (!host) return reply.code(404).send({ error: "HOST_NOT_FOUND" });

        const { rows } = await app.db.query(
          `
          SELECT
            id,
            host_user_id,
            title,
            status,
            vehicle_type,
            transmission,
            seats::int AS seats,
            price_per_day::int AS price_per_day,
            price_per_hour,
            currency,
            country_code,
            city,
            area,
            full_address,

            pickup_lat,
            pickup_lng,
            pickup_address,

            COALESCE(NULLIF(make, ''),  features->'vehicle'->>'make') AS make,
            COALESCE(NULLIF(model,''),  features->'vehicle'->>'model') AS model,
            COALESCE(NULLIF(trim, ''),  features->'vehicle'->>'trim') AS trim,

            COALESCE(
              year,
              NULLIF((features->'vehicle'->>'year')::int, 0)
            ) AS year,

            COALESCE(NULLIF(body_type::text, ''), features->'vehicle'->>'body_type') AS body_type,
            COALESCE(NULLIF(fuel_type::text, ''), features->'vehicle'->>'fuel_type') AS fuel_type,

            doors,
            ev_range_km,
            odometer_km,

            image_path,
            image_public,
            has_image,
            image_gallery,

            is_popular,
            is_featured,

            COALESCE(NULLIF(pickup_city,''),        features->'pickup'->>'pickup_city')        AS pickup_city,
            COALESCE(NULLIF(pickup_state,''),       features->'pickup'->>'pickup_state')       AS pickup_state,
            COALESCE(NULLIF(pickup_country,''),     features->'pickup'->>'pickup_country')     AS pickup_country,
            COALESCE(NULLIF(pickup_postal_code,''), features->'pickup'->>'pickup_postal_code') AS pickup_postal_code,

            features,
            requirements,
            pricing_rules,

            created_at,
            updated_at,
            deleted_at
          FROM cars
          WHERE id = $1
            AND host_user_id = $2
            AND deleted_at IS NULL
          LIMIT 1
          `,
          [carId, userId]
        );

        if (!rows[0]) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        }

        return reply.send({ car: normalizeCarRow(rows[0]) });
      } catch (e: any) {
        req.log.error({ err: e }, "GET /host/cars/:id failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to load car.",
        });
      }
    }
  );

  /**
   * POST /api/host/cars
   * ✅ Change: sanitizeCarCreate now denorms from features.*
   */
  app.post(
    "/host/cars",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const host = await getHostByUserId(app, userId);
        if (!host) return reply.code(404).send({ error: "HOST_NOT_FOUND" });

        const patch = sanitizeCarCreate(req.body);

        if (
          !isNonEmptyString(patch.title) ||
          !isNonEmptyString(patch.vehicle_type) ||
          !isNonEmptyString(patch.transmission)
        ) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message:
              "title, vehicle_type, transmission are required to create a draft car.",
          });
        }

        const cols = ["host_user_id", ...Object.keys(patch)];
        const vals = [userId, ...Object.values(patch)];
        const placeholders = cols.map((_, i) => `$${i + 1}`);

        const { rows } = await app.db.query(
          `
          INSERT INTO cars (${cols.join(", ")})
          VALUES (${placeholders.join(", ")})
          RETURNING *
          `,
          vals
        );

        return reply.code(201).send({ car: normalizeCarRow(rows[0]) });
      } catch (e: any) {
        req.log.error({ err: e }, "POST /host/cars failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: e?.detail || e?.message || "Failed to create car.",
        });
      }
    }
  );

  /**
   * PATCH /api/host/cars/:id
   * ✅ Change: sanitizeCarPatch now denorms from features.* as fallback
   */
  app.patch(
    "/host/cars/:id",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId)
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const patch = sanitizeCarPatch(req.body);

        const keys = Object.keys(patch);
        if (keys.length === 0) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: "No valid updates provided.",
          });
        }

        const { sets, values } = buildUpdateSql(patch);

        values.push(carId);
        values.push(userId);

        const { rows } = await app.db.query(
          `
          UPDATE cars
          SET ${sets.join(", ")}
          WHERE id = $${keys.length + 1}
            AND host_user_id = $${keys.length + 2}
            AND deleted_at IS NULL
          RETURNING *
          `,
          values
        );

        if (!rows[0]) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        }

        return reply.send({ car: normalizeCarRow(rows[0]) });
      } catch (e: any) {
        req.log.error({ err: e }, "PATCH /host/cars/:id failed");
        return reply
          .code(500)
          .send({ error: "INTERNAL_ERROR", message: "Failed to update car." });
      }
    }
  );

  /**
   * DELETE /api/host/cars/:id
   * Soft "deactivate" (NO DB delete, NO bucket cleanup)
   */
  app.delete(
    "/host/cars/:id",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId) {
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });
      }

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const { rows: existingRows } = await app.db.query(
          `
          SELECT id, status
          FROM cars
          WHERE id = $1
            AND host_user_id = $2
            AND deleted_at IS NULL
          LIMIT 1
          `,
          [carId, userId]
        );

        const existing = existingRows[0];
        if (!existing) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        }

        const { rows } = await app.db.query(
          `
          UPDATE cars
          SET status = 'inactive',
              updated_at = now()
          WHERE id = $1
            AND host_user_id = $2
            AND deleted_at IS NULL
          RETURNING *;
          `,
          [carId, userId]
        );

        return reply.send({
          car: normalizeCarRow(rows[0]),
          note: "Car marked inactive. No files were deleted.",
        });
      } catch (e: any) {
        req.log.error({ err: e }, "DELETE /host/cars/:id (deactivate) failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to deactivate car.",
        });
      }
    }
  );

  /**
   * POST /api/host/cars/:id/activate
   */
  app.post(
    "/host/cars/:id/activate",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const carId = String((req.params as any)?.id || "").trim();
      if (!carId) return reply.code(400).send({ error: "Missing car id" });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const { rows } = await app.db.query(
          `
          UPDATE cars
          SET status = 'active',
              updated_at = now()
          WHERE id = $1
            AND host_user_id = $2
            AND deleted_at IS NULL
          RETURNING *;
          `,
          [carId, userId]
        );

        if (!rows[0]) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        }

        return reply.send({ car: normalizeCarRow(rows[0]) });
      } catch (e: any) {
        req.log.error({ err: e }, "POST /host/cars/:id/activate failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to activate car.",
        });
      }
    }
  );

  /**
   * POST /api/host/cars/:id/publish
   * ✅ Change: uses NULLIF(column,'') so publish will overwrite "empty-string columns"
   */
  app.post(
    "/host/cars/:id/publish",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const carId = String((req.params as any)?.id || "").trim();
      if (!carId) return reply.code(400).send({ error: "Missing car id" });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const host = await getHostByUserId(app, userId);
        if (!host) {
          return reply.code(404).send({
            error: "HOST_NOT_FOUND",
            message: "Host profile not found.",
          });
        }

        const existingRes = await app.db.query(
          `SELECT * FROM cars WHERE id = $1 AND host_user_id = $2 AND deleted_at IS NULL LIMIT 1`,
          [carId, userId]
        );

        const existing = existingRes.rows?.[0];
        if (!existing) return reply.code(404).send({ error: "CAR_NOT_FOUND" });

        const body = (req.body ?? {}) as any;

        // Merge features: keep existing.features unless provided
        const nextFeatures =
          body.features && typeof body.features === "object"
            ? body.features
            : existing.features ?? {};

        const denorm = denormCarColumnsFromBody({
          ...body,
          features: nextFeatures,
        });

        const sql = `
          UPDATE cars
          SET
            status = 'active',
            updated_at = NOW(),

            features = $1::jsonb,

            -- treat "" as NULL on the column side so COALESCE can apply your denorm values
            make  = COALESCE($2, NULLIF(make, '')),
            model = COALESCE($3, NULLIF(model,'')),
            trim  = COALESCE($4, NULLIF(trim, '')),
            year  = COALESCE($5, year),

            body_type = CASE
            WHEN $6 IS NULL OR $6 = '' THEN body_type
            ELSE $6::car_body_type
          END,
          
          fuel_type = CASE
            WHEN $7 IS NULL OR $7 = '' THEN fuel_type
            ELSE $7::car_fuel_type
          END,

            pickup_city        = COALESCE($8,  NULLIF(pickup_city,'')),
            pickup_state       = COALESCE($9,  NULLIF(pickup_state,'')),
            pickup_country     = COALESCE($10, NULLIF(pickup_country,'')),
            pickup_postal_code = COALESCE($11, NULLIF(pickup_postal_code,''))

          WHERE id = $12 AND host_user_id = $13 AND deleted_at IS NULL
          RETURNING *;
        `;

        const params = [
          JSON.stringify(nextFeatures),

          denorm.make,
          denorm.model,
          denorm.trim,
          denorm.year,

          denorm.body_type,
          denorm.fuel_type,

          denorm.pickup_city,
          denorm.pickup_state,
          denorm.pickup_country,
          denorm.pickup_postal_code,

          carId,
          userId,
        ];

        const upd = await app.db.query(sql, params);
        return reply.send({ car: normalizeCarRow(upd.rows[0]) });
      } catch (e: any) {
        req.log.error({ err: e }, "POST /host/cars/:id/publish failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to publish car.",
        });
      }
    }
  );

  /**
   * POST /api/host/cars/:id/unpublish
   */
  app.post(
    "/host/cars/:id/unpublish",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId)
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const { rows } = await app.db.query(
          `
          UPDATE cars
          SET status = 'draft'::car_status,
              updated_at = now()
          WHERE id = $1
            AND host_user_id = $2
            AND deleted_at IS NULL
          RETURNING *
          `,
          [carId, userId]
        );

        if (!rows[0])
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });

        return reply.send({ car: normalizeCarRow(rows[0]) });
      } catch (e: any) {
        req.log.error({ err: e }, "POST /host/cars/:id/unpublish failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to unpublish car.",
        });
      }
    }
  );

  /**
   * POST /api/host/cars/:id/photos/upload-url
   */
  app.post(
    "/host/cars/:id/photos/upload-url",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId) {
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });
      }

      const body = (req.body ?? {}) as { mimeType: string; fileName?: string };

      const mimeType = String(body?.mimeType || "")
        .trim()
        .toLowerCase();
      const allowed = new Set([
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
      ]);
      if (!allowed.has(mimeType)) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "Only image/jpeg, image/png, image/webp are allowed.",
        });
      }

      const ext = mimeType.includes("png")
        ? "png"
        : mimeType.includes("webp")
        ? "webp"
        : "jpg";

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const { rows: carRows } = await app.db.query(
          `
          SELECT id, host_user_id, image_gallery
          FROM cars
          WHERE id = $1
            AND host_user_id = $2
            AND deleted_at IS NULL
          LIMIT 1
          `,
          [carId, userId]
        );
        const car = carRows[0];
        if (!car) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        }

        const photoId = crypto.randomUUID();
        const objectPath = `cars/${carId}/${photoId}.${ext}`;
        const file = gcsBucket.file(objectPath);

        const [uploadUrl] = await file.getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000,
          contentType: mimeType,
        });

        return reply.send({
          uploadUrl,
          photo: {
            id: photoId,
            path: objectPath,
            mime: mimeType,
            url: gcsPublicUrl(objectPath),
          },
        });
      } catch (e: any) {
        req.log.error({ err: e }, "upload-url failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to generate upload URL.",
        });
      }
    }
  );

  /**
   * POST /api/host/cars/:id/photos/finalize
   */
  app.post(
    "/host/cars/:id/photos/finalize",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };
      const carId = String(id || "").trim();
      if (!carId) {
        return reply
          .code(400)
          .send({ error: "VALIDATION_ERROR", message: "id is required." });
      }

      const body = (req.body ?? {}) as {
        photos: Array<{
          id: string;
          path: string;
          url?: string;
          mime?: string;
          width?: number;
          height?: number;
        }>;
      };

      const photos = Array.isArray(body.photos) ? body.photos : [];
      const clean = photos
        .map((p) => ({
          id: typeof p?.id === "string" ? p.id : "",
          path: typeof p?.path === "string" ? p.path : "",
          url: typeof p?.url === "string" ? p.url : "",
          mime: typeof p?.mime === "string" ? p.mime : "",
          width: typeof p?.width === "number" ? p.width : undefined,
          height: typeof p?.height === "number" ? p.height : undefined,
          created_at: new Date().toISOString(),
        }))
        .filter((p) => p.id && p.path);

      if (clean.length === 0) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "photos[] is required",
        });
      }

      try {
        const userId = await getDbUserIdByFirebaseUid(app, auth.uid);
        if (!userId) return reply.code(404).send({ error: "User not found" });

        const { rows: carRows } = await app.db.query(
          `
          SELECT *
          FROM cars
          WHERE id = $1
            AND host_user_id = $2
            AND deleted_at IS NULL
          LIMIT 1
          `,
          [carId, userId]
        );
        const car = carRows[0];
        if (!car) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "Car not found (or not owned by you).",
          });
        }

        const existing = Array.isArray(car.image_gallery)
          ? car.image_gallery
          : safeJsonParse(car.image_gallery, []);

        const map = new Map<string, any>();
        for (const item of existing) {
          if (item?.id) map.set(String(item.id), item);
        }
        for (const item of clean) {
          map.set(String(item.id), {
            ...item,
            url: item.url || gcsPublicUrl(item.path),
          });
        }

        const merged = Array.from(map.values());
        const hasImage = merged.length > 0;

        const coverUrl = hasImage
          ? String(merged[0]?.url || gcsPublicUrl(merged[0]?.path || "")).trim()
          : "draft/placeholder.jpg";

        const { rows } = await app.db.query(
          `
          UPDATE cars
          SET image_gallery = $1::jsonb,
              has_image = $2,
              image_path = $3,
              updated_at = now()
          WHERE id = $4
            AND host_user_id = $5
            AND deleted_at IS NULL
          RETURNING *
          `,
          [JSON.stringify(merged), hasImage, coverUrl, carId, userId]
        );

        return reply.send({ car: normalizeCarRow(rows[0]) });
      } catch (e: any) {
        req.log.error({ err: e }, "finalize failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to finalize photos.",
        });
      }
    }
  );
};

export default hostCarsRoutes;

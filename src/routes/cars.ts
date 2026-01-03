import type { FastifyPluginAsync } from "fastify";

// -------------------------------------------------------------------------------------
// Cars routes (Fastify + PostgreSQL)
// -------------------------------------------------------------------------------------

type SortKey =
  | "newest"
  | "price_asc"
  | "price_desc"
  | "rating_desc"
  | "popular";

type CarStatus = "active" | "inactive" | "draft" | "unlisted" | string;

type CarsListQuery = Partial<{
  country: string; // country_code
  city: string;
  area: string;
  type: string; // vehicle_type
  transmission: string;
  fuel: string; // fuel_type
  seats: string;
  yearMin: string;
  yearMax: string;
  minPrice: string;
  maxPrice: string;
  hasImage: string; // "true" | "false"
  status: string; // car_status
  q: string; // search term
  sort: SortKey;
  limit: string;
  offset: string;
}>;

type CarsMapQuery = CarsListQuery &
  Partial<{
    minLat: string;
    maxLat: string;
    minLng: string;
    maxLng: string;

    // optional radius mode
    lat: string;
    lng: string;
    radiusKm: string; // 1..50
  }>;

type IdParams = { id: string };

type CarItem = {
  id: string;
  title: string | null;
  vehicleType: string | null;
  transmission: string | null;
  fuelType: string | null;
  seats: number | null;
  year: number | null;
  currency: string | null;
  pricePerDay: number | null;
  rating: number | null;
  reviews: number | null;
  status: CarStatus | null;
  address: {
    countryCode: string | null;
    city: string | null;
    area: string | null;
    fullAddress: string | null;
  };
  pickup: {
    lat: number | null;
    lng: number | null;
  };
  hasImage: boolean;
  imagePublic: boolean;
  imagePath: string | null;
  imageUrl: string | null;
  gallery: unknown[] | null;
  isPopular: boolean;
  isFeatured: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  distanceKm?: number | null;
};

type PageMeta = { limit: number; offset: number; total: number };

// -------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function normalizeArea(area: unknown) {
  const s = normalizeStr(area);
  return s ?? null;
}

function isPlainObject(v: any) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseNumber(v: any): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return undefined;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseIntLike(v: any): number | undefined {
  const n = parseNumber(v);
  if (n == null) return undefined;
  return Math.trunc(n);
}

function parseLat(v: any): number | undefined {
  const n = parseNumber(v);
  if (n == null) return undefined;
  if (n < -90 || n > 90) return undefined;
  return n;
}

function parseLng(v: any): number | undefined {
  const n = parseNumber(v);
  if (n == null) return undefined;
  if (n < -180 || n > 180) return undefined;
  return n;
}

function mediaBase() {
  return process.env.MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, "");
}

function computeImageUrl(row: any) {
  const base = mediaBase();
  const placeholder = base ? `${base}/cars/placeholder-car.jpg` : null;

  const has = row?.has_image === true || row?.has_image === "true";
  const isPublic = row?.image_public !== false && row?.image_public !== "false"; // default true

  const raw = row?.image_path ? String(row.image_path).trim() : "";

  if (has && isPublic && /^https?:\/\//i.test(raw)) return raw;

  if (base && has && isPublic && raw) {
    const cleanBase = String(base).replace(/\/$/, "");
    const cleanPath = raw.replace(/^\//, "");
    return `${cleanBase}/${cleanPath}`;
  }

  return placeholder;
}

function toCarItem(row: any): CarItem {
  return {
    id: String(row.id),
    title: row.title ?? null,
    vehicleType: row.vehicle_type ?? null,
    transmission: row.transmission ?? null,
    fuelType: row.fuel_type ?? null,
    seats: row.seats == null ? null : Number(row.seats),
    year: row.year == null ? null : Number(row.year),
    currency: row.currency ?? null,
    pricePerDay: row.price_per_day == null ? null : Number(row.price_per_day),
    rating:
      row.rating_avg != null
        ? Number(row.rating_avg)
        : row.rating != null
        ? Number(row.rating)
        : null,
    reviews:
      row.rating_count != null
        ? Number(row.rating_count)
        : row.reviews != null
        ? Number(row.reviews)
        : null,
    status: (row.status ?? null) as CarStatus | null,
    address: {
      countryCode: row.country_code ?? null,
      city: row.city ?? null,
      area: normalizeArea(row.area),
      fullAddress: row.full_address ?? null,
    },
    pickup: {
      lat: row.pickup_lat == null ? null : Number(row.pickup_lat),
      lng: row.pickup_lng == null ? null : Number(row.pickup_lng),
    },
    hasImage: !!row.has_image,
    imagePublic: row.image_public !== false,
    imagePath: row.image_path ?? null,
    imageUrl: computeImageUrl(row),
    gallery: Array.isArray(row.image_gallery) ? row.image_gallery : null,
    isPopular: !!row.is_popular,
    isFeatured: !!row.is_featured,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    distanceKm: row.distance_km == null ? null : Number(row.distance_km),
  };
}

function sendDbError(reply: any, _err: unknown) {
  reply.code(500).send({
    error: "Internal Server Error",
    message: "Database query failed",
  });
}

function buildWhere(q: CarsListQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  where.push(`deleted_at IS NULL`);
  if (!normalizeStr(q.status)) {
  where.push(`status = 'active'`);
  }

  const country = normalizeStr(q.country);
  const city = normalizeStr(q.city);
  const area = normalizeStr(q.area);
  const type = normalizeStr(q.type);
  const transmission = normalizeStr(q.transmission);
  const fuel = normalizeStr(q.fuel);
  const status = normalizeStr(q.status);

  if (country) {
    where.push(`country_code = $${i++}`);
    params.push(country);
  }
  if (city) {
    where.push(`LOWER(city) LIKE LOWER($${i++})`);
    params.push(`%${city}%`);
  }
  if (area) {
    where.push(`LOWER(COALESCE(area,'')) LIKE LOWER($${i++})`);
    params.push(`%${area}%`);
  }
  if (type) {
    where.push(`vehicle_type = $${i++}`);
    params.push(type);
  }
  if (transmission) {
    where.push(`transmission = $${i++}`);
    params.push(transmission);
  }
  if (fuel) {
    where.push(`fuel_type = $${i++}`);
    params.push(fuel);
  }
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }

  const seats = parseIntLike(q.seats);
  if (seats != null) {
    where.push(`seats = $${i++}`);
    params.push(seats);
  }

  let yearMin = parseIntLike(q.yearMin);
  let yearMax = parseIntLike(q.yearMax);
  if (yearMin != null && yearMax != null && yearMin > yearMax) {
    [yearMin, yearMax] = [yearMax, yearMin];
  }
  if (yearMin != null) {
    where.push(`year >= $${i++}`);
    params.push(yearMin);
  }
  if (yearMax != null) {
    where.push(`year <= $${i++}`);
    params.push(yearMax);
  }

  let minPrice = parseNumber(q.minPrice);
  let maxPrice = parseNumber(q.maxPrice);
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  if (minPrice != null) {
    where.push(`price_per_day >= $${i++}`);
    params.push(minPrice);
  }
  if (maxPrice != null) {
    where.push(`price_per_day <= $${i++}`);
    params.push(maxPrice);
  }

  if (q.hasImage === "true")
    where.push(`has_image = true AND image_public = true`);
  if (q.hasImage === "false") where.push(`has_image = false`);

  const term = normalizeStr(q.q);
  if (term) {
    where.push(
      `(
        LOWER(title) LIKE LOWER($${i}) OR
        LOWER(COALESCE(make,''))  LIKE LOWER($${i}) OR
        LOWER(COALESCE(model,'')) LIKE LOWER($${i}) OR
        LOWER(city)               LIKE LOWER($${i}) OR
        LOWER(COALESCE(area,''))  LIKE LOWER($${i})
      )`
    );
    params.push(`%${term}%`);
    i++;
  }

  return { where, params };
}

function buildOrder(sort: SortKey | undefined) {
  switch (sort) {
    case "price_asc":
      return `price_per_day ASC NULLS LAST, created_at DESC`;
    case "price_desc":
      return `price_per_day DESC NULLS LAST, created_at DESC`;
    case "rating_desc":
      return `COALESCE(rating_avg, rating) DESC NULLS LAST, created_at DESC`;
    case "newest":
      return `created_at DESC`;
    case "popular":
    default:
      return `is_popular DESC, COALESCE(rating_avg, rating) DESC NULLS LAST, created_at DESC`;
  }
}

function selectBaseFields() {
  // NOTE: Keeping your existing return shape; extra columns are safe to select.
  return `
    id,
    title,
    vehicle_type,
    transmission,
    fuel_type,
    seats,
    year,
    currency,
    price_per_day,
    rating,
    reviews,
    rating_avg,
    rating_count,
    status,
    country_code,
    city,
    area,
    full_address,
    pickup_lat,
    pickup_lng,
    image_path,
    image_gallery,
    has_image,
    image_public,
    is_popular,
    is_featured,
    created_at,
    updated_at,
    make,
    model,
    trim,
    body_type,
    pickup_city,
    pickup_state,
    pickup_country,
    pickup_postal_code,
    features
  `;
}

function asBool(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  if (typeof v !== "string") return undefined;
  const s = v.toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return undefined;
}

// -------------------------------------------------------------------------------------
// ✅ Denormalize helpers (exactly as you provided)
// -------------------------------------------------------------------------------------

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
 * This guarantees columns get updated correctly.
 */
function denormCarColumnsFromBody(body: any) {
  const features = body?.features ?? {};
  const vehicle = features?.vehicle ?? {};
  const address = features?.address ?? {};
  const pickup = features?.pickup ?? {};

  // NOTE: your frontend uses vehicle_type; DB column is body_type
  const bodyType =
    pickString(body?.body_type) ??
    pickString(body?.vehicle_type) ??
    pickString(vehicle?.body_type) ??
    pickString(vehicle?.vehicle_type) ??
    null;

  return {
    make: pickString(body?.make) ?? pickString(vehicle?.make),
    model: pickString(body?.model) ?? pickString(vehicle?.model),
    trim: pickString(body?.trim) ?? pickString(vehicle?.trim),
    year: pickInt(body?.year) ?? pickInt(vehicle?.year),

    body_type: bodyType,
    fuel_type: pickString(body?.fuel_type) ?? pickString(vehicle?.fuel_type),

    pickup_city:
      pickString(body?.pickup_city) ??
      pickString(pickup?.pickup_city) ??
      pickString(address?.city) ??
      pickString(body?.city),

    pickup_state:
      pickString(body?.pickup_state) ??
      pickString(pickup?.pickup_state) ??
      pickString(address?.province) ??
      pickString(body?.area) ??
      pickString(body?.province),

    pickup_country:
      pickString(body?.pickup_country) ??
      pickString(pickup?.pickup_country) ??
      pickString(address?.country_code) ??
      pickString(body?.country_code),

    pickup_postal_code:
      pickString(body?.pickup_postal_code) ??
      pickString(pickup?.pickup_postal_code) ??
      pickString(address?.postal_code),
  };
}

// -------------------------------------------------------------------------------------
// WRITE types (extended for pickup + jsonb compatibility)
// -------------------------------------------------------------------------------------

type CarUpsertBody = Partial<{
  title: string;
  vehicle_type: string;
  transmission: string;
  fuel_type: string;
  seats: number | string;
  year: number | string;
  currency: string;
  price_per_day: number | string;

  // ✅ these are real columns you said are not updating
  make: string;
  model: string;
  trim: string;
  body_type: string;

  country_code: string;
  city: string;
  area: string;
  full_address: string;

  pickup_lat: number | string;
  pickup_lng: number | string;
  pickup_address: string;
  pickup_city: string;
  pickup_state: string;
  pickup_country: string;
  pickup_postal_code: string;

  // allow client legacy nesting
  features: any;

  image_path: string;
  image_public: boolean | string;
  has_image: boolean | string;
  image_gallery: unknown[];

  is_popular: boolean | string;
  is_featured: boolean | string;
  status: CarStatus;
}>;

function extractPickupPatch(body: any) {
  const out: Record<string, any> = {};

  // top-level
  const topLat = parseLat(body?.pickup_lat);
  const topLng = parseLng(body?.pickup_lng);

  // nested legacy: features.pickup.*
  const pick = body?.features?.pickup;
  const nestedLat = isPlainObject(pick) ? parseLat(pick.pickup_lat) : undefined;
  const nestedLng = isPlainObject(pick) ? parseLng(pick.pickup_lng) : undefined;

  const lat = topLat ?? nestedLat;
  const lng = topLng ?? nestedLng;

  if (lat != null) out.pickup_lat = lat;
  if (lng != null) out.pickup_lng = lng;

  // address-ish
  const topAddr = normalizeStr(body?.pickup_address);
  const nestedAddr = isPlainObject(pick)
    ? normalizeStr(pick.pickup_address)
    : undefined;
  const addr = topAddr ?? nestedAddr;
  if (addr != null) out.pickup_address = addr;

  const topCity = normalizeStr(body?.pickup_city);
  const nestedCity = isPlainObject(pick)
    ? normalizeStr(pick.pickup_city)
    : undefined;
  const city = topCity ?? nestedCity;
  if (city != null) out.pickup_city = city;

  const topState = normalizeStr(body?.pickup_state);
  const nestedState = isPlainObject(pick)
    ? normalizeStr(pick.pickup_state)
    : undefined;
  const state = topState ?? nestedState;
  if (state != null) out.pickup_state = state;

  const topCountry = normalizeStr(body?.pickup_country);
  const nestedCountry = isPlainObject(pick)
    ? normalizeStr(pick.pickup_country)
    : undefined;
  const country = topCountry ?? nestedCountry;
  if (country != null) out.pickup_country = country;

  const topPostal = normalizeStr(body?.pickup_postal_code);
  const nestedPostal = isPlainObject(pick)
    ? normalizeStr(pick.pickup_postal_code)
    : undefined;
  const postal = topPostal ?? nestedPostal;
  if (postal != null) out.pickup_postal_code = postal;

  return out;
}

function sanitizeUpsert(body: CarUpsertBody, isCreate: boolean) {
  const out: Record<string, any> = {};

  const title = normalizeStr(body.title);
  const vehicleType = normalizeStr(body.vehicle_type);
  const countryCode = normalizeStr(body.country_code);
  const city = normalizeStr(body.city);

  if (isCreate) {
    // required fields on create
    if (title) out.title = title;
    if (vehicleType) out.vehicle_type = vehicleType;
    if (countryCode) out.country_code = countryCode.toUpperCase();
    if (city) out.city = city;
  } else {
    // allow patching to empty strings? no — keep normalized behavior.
    if (body.title !== undefined) out.title = title ?? "";
    if (body.vehicle_type !== undefined) out.vehicle_type = vehicleType ?? "";
    if (body.country_code !== undefined)
      out.country_code = (countryCode ?? "").toUpperCase();
    if (body.city !== undefined) out.city = city ?? "";
  }

  // optional strings
  if (body.transmission !== undefined)
    out.transmission = normalizeStr(body.transmission) ?? "";
  if (body.fuel_type !== undefined)
    out.fuel_type = normalizeStr(body.fuel_type) ?? "";

  if (body.area !== undefined) out.area = normalizeStr(body.area) ?? null;
  if (body.full_address !== undefined)
    out.full_address = normalizeStr(body.full_address) ?? "";

  if (body.currency !== undefined)
    out.currency = normalizeStr(body.currency) ?? null;

  // numbers (accept numeric strings)
  if (body.price_per_day !== undefined) {
    const n = parseIntLike(body.price_per_day);
    if (n != null) out.price_per_day = clamp(n, 0, 1_000_000);
  }
  if (body.seats !== undefined) {
    const n = parseIntLike(body.seats);
    if (n != null) out.seats = clamp(n, 1, 99);
  }
  if (body.year !== undefined) {
    const n = parseIntLike(body.year);
    const thisYear = new Date().getFullYear() + 1;
    if (n != null) out.year = clamp(n, 1950, thisYear);
  }

  // ✅ denormed vehicle columns (top-level OR features.vehicle.*)
  const den = denormCarColumnsFromBody(body);
  if (den.make != null) out.make = den.make;
  if (den.model != null) out.model = den.model;
  if (den.trim != null) out.trim = den.trim;
  if (den.year != null) out.year = den.year; // safe overwrite if provided via features
  if (den.body_type != null) out.body_type = den.body_type;
  if (den.fuel_type != null) out.fuel_type = den.fuel_type;

  // ✅ pickup fields (top-level OR features.pickup.*)
  Object.assign(out, extractPickupPatch(body));

  // ✅ pickup denorm from address fallback (if not already present)
  if (out.pickup_city == null && den.pickup_city != null)
    out.pickup_city = den.pickup_city;
  if (out.pickup_state == null && den.pickup_state != null)
    out.pickup_state = den.pickup_state;
  if (out.pickup_country == null && den.pickup_country != null)
    out.pickup_country = den.pickup_country;
  if (out.pickup_postal_code == null && den.pickup_postal_code != null)
    out.pickup_postal_code = den.pickup_postal_code;

  // images / flags
  if (body.image_path !== undefined)
    out.image_path = normalizeStr(body.image_path) ?? "";
  if (body.image_public !== undefined) {
    const b = asBool(body.image_public);
    if (b != null) out.image_public = b;
  }
  if (body.has_image !== undefined) {
    const b = asBool(body.has_image);
    if (b != null) out.has_image = b;
  }
  if (body.is_popular !== undefined) {
    const b = asBool(body.is_popular);
    if (b != null) out.is_popular = b;
  }
  if (body.is_featured !== undefined) {
    const b = asBool(body.is_featured);
    if (b != null) out.is_featured = b;
  }
  if (body.status !== undefined) {
    const s = normalizeStr(body.status);
    if (s) out.status = s;
  }

  if (body.image_gallery !== undefined && Array.isArray(body.image_gallery))
    out.image_gallery = body.image_gallery;

  // keep features if provided (but do NOT rely on it for pickup columns)
  if (body.features !== undefined && isPlainObject(body.features))
    out.features = body.features;

  return out;
}

function validateUpsertSanitized(
  patch: Record<string, any>,
  isCreate: boolean
) {
  if (isCreate) {
    if (
      !normalizeStr(patch.title) ||
      !normalizeStr(patch.vehicle_type) ||
      !normalizeStr(patch.country_code) ||
      !normalizeStr(patch.city)
    ) {
      return {
        ok: false as const,
        message: "title, vehicle_type, country_code, and city are required",
      };
    }
  }

  if (patch.price_per_day != null) {
    const n = Number(patch.price_per_day);
    if (!Number.isFinite(n) || n < 0) {
      return {
        ok: false as const,
        message: "price_per_day must be a positive number",
      };
    }
  }

  if (patch.seats != null) {
    const n = Number(patch.seats);
    if (!Number.isFinite(n) || n < 1 || n > 99) {
      return { ok: false as const, message: "seats must be between 1 and 99" };
    }
  }

  if (patch.year != null) {
    const n = Number(patch.year);
    const thisYear = new Date().getFullYear() + 1;
    if (!Number.isFinite(n) || n < 1950 || n > thisYear) {
      return {
        ok: false as const,
        message: `year must be between 1950 and ${thisYear}`,
      };
    }
  }

  // lat/lng sanity if present
  if (patch.pickup_lat != null) {
    const n = Number(patch.pickup_lat);
    if (!Number.isFinite(n) || n < -90 || n > 90) {
      return {
        ok: false as const,
        message: "pickup_lat must be between -90 and 90",
      };
    }
  }
  if (patch.pickup_lng != null) {
    const n = Number(patch.pickup_lng);
    if (!Number.isFinite(n) || n < -180 || n > 180) {
      return {
        ok: false as const,
        message: "pickup_lng must be between -180 and 180",
      };
    }
  }

  return { ok: true as const };
}

// -------------------------------------------------------------------------------------
// Plugin
// -------------------------------------------------------------------------------------

const carsRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------
  // READ routes (public)
  // ---------------------------------------------

  app.get("/cars", async (req, reply) => {
    const q = (req.query ?? {}) as CarsListQuery;

    const { where, params } = buildWhere(q);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const limit = clamp(Number(q.limit ?? 20) || 20, 1, 50);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    const orderBy = buildOrder(q.sort);

    try {
      const countRes = await app.db.query(
        `SELECT COUNT(*)::int AS total FROM cars ${whereSql};`,
        params
      );
      const total: number = countRes.rows?.[0]?.total ?? 0;

      const rowsSql = `
        SELECT ${selectBaseFields()}
        FROM cars
        ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset};
      `;
      const rowsRes = await app.db.query(rowsSql, params);
      const items = (rowsRes.rows ?? []).map(toCarItem);

      return reply.send({
        items,
        page: { limit, offset, total } satisfies PageMeta,
      });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.get("/cars/map", async (req, reply) => {
    const q = (req.query ?? {}) as CarsMapQuery;

    const minLat = parseNumber(q.minLat);
    const maxLat = parseNumber(q.maxLat);
    const minLng = parseNumber(q.minLng);
    const maxLng = parseNumber(q.maxLng);

    if (minLat == null || maxLat == null || minLng == null || maxLng == null) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "minLat,maxLat,minLng,maxLng are required",
      });
    }
    if (minLat > maxLat || minLng > maxLng) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "minLat <= maxLat and minLng <= maxLng",
      });
    }

    const lat = parseNumber(q.lat);
    const lng = parseNumber(q.lng);
    const radiusKmRaw = parseNumber(q.radiusKm);
    const hasRadius = lat != null && lng != null && radiusKmRaw != null;
    const radiusKm = hasRadius ? clamp(radiusKmRaw!, 1, 50) : undefined;

    const { where, params } = buildWhere(q);
    let i = params.length + 1;

    // must have coords for map
    where.push(`pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL`);

    // bbox filter
    where.push(`pickup_lat BETWEEN $${i++} AND $${i++}`);
    (params as any[]).push(minLat, maxLat);

    where.push(`pickup_lng BETWEEN $${i++} AND $${i++}`);
    (params as any[]).push(minLng, maxLng);

    // Default map to active if not specified
    if (!normalizeStr(q.status)) where.push(`status = 'active'`);

    let distanceSelectSql = "";
    let orderSql = buildOrder(q.sort);

    if (hasRadius) {
      const latIdx = i++;
      (params as any[]).push(lat);

      const lngIdx = i++;
      (params as any[]).push(lng);

      const radIdx = i++;
      (params as any[]).push(radiusKm);

      where.push(`
        ST_DWithin(
          ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint($${lngIdx}, $${latIdx}), 4326)::geography,
          ($${radIdx} * 1000.0)
        )
      `);

      distanceSelectSql = `,
        ROUND(
          (
            ST_Distance(
              ST_SetSRID(ST_MakePoint(pickup_lng, pickup_lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint($${lngIdx}, $${latIdx}), 4326)::geography
            ) / 1000.0
          )::numeric,
          1
        ) AS distance_km
      `;

      orderSql = `distance_km ASC NULLS LAST, ${orderSql}`;
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const limit = clamp(Number(q.limit ?? 200) || 200, 1, 500);

    try {
      const sql = `
        SELECT ${selectBaseFields()}
        ${distanceSelectSql}
        FROM cars
        ${whereSql}
        ORDER BY ${orderSql}
        LIMIT ${limit};
      `;

      const res = await app.db.query(sql, params);
      return reply.send({ items: (res.rows ?? []).map(toCarItem) });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.get("/cars/filters", async (req, reply) => {
    const q = (req.query ?? {}) as Partial<{ country: string }>;
    const params: unknown[] = [];
    const where: string[] = [
  `deleted_at IS NULL`,
  `status = 'active'`,
];

    if (normalizeStr(q.country)) {
      params.push(String(q.country));
      where.push(`country_code = $1`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    try {
      const [
        typesRes,
        transRes,
        fuelRes,
        seatsRes,
        yearsRes,
        priceRes,
        citiesRes,
        areasRes,
      ] = await Promise.all([
        app.db.query(
          `SELECT DISTINCT vehicle_type AS value FROM cars ${whereSql} ORDER BY value ASC;`,
          params
        ),
        app.db.query(
          `SELECT DISTINCT transmission AS value FROM cars ${whereSql} ORDER BY value ASC;`,
          params
        ),
        app.db.query(
          `SELECT DISTINCT fuel_type AS value FROM cars ${whereSql} ORDER BY value ASC;`,
          params
        ),
        app.db.query(
          `SELECT DISTINCT seats AS value FROM cars ${whereSql} ORDER BY value ASC;`,
          params
        ),
        app.db.query(
          `SELECT MIN(year)::int AS min, MAX(year)::int AS max FROM cars ${whereSql};`,
          params
        ),
        app.db.query(
          `SELECT MIN(price_per_day)::int AS min, MAX(price_per_day)::int AS max FROM cars ${whereSql};`,
          params
        ),
        app.db.query(
          `SELECT DISTINCT city AS value FROM cars ${whereSql} ORDER BY value ASC;`,
          params
        ),
        app.db.query(
          `
          SELECT DISTINCT area AS value
          FROM cars
          ${whereSql} AND area IS NOT NULL AND TRIM(area) <> ''
          ORDER BY value ASC;
          `,
          params
        ),
      ]);

      const priceRow = priceRes.rows?.[0] ?? { min: null, max: null };
      const yearsRow = yearsRes.rows?.[0] ?? { min: null, max: null };

      return reply.send({
        country: normalizeStr(q.country) ?? null,
        vehicleTypes: (typesRes.rows ?? [])
          .map((r: any) => r.value)
          .filter(Boolean),
        transmissions: (transRes.rows ?? [])
          .map((r: any) => r.value)
          .filter(Boolean),
        fuelTypes: (fuelRes.rows ?? [])
          .map((r: any) => r.value)
          .filter(Boolean),
        seats: (seatsRes.rows ?? [])
          .map((r: any) => Number(r.value))
          .filter((n: any) => Number.isFinite(n)),
        year: { min: yearsRow.min, max: yearsRow.max },
        pricePerDay: { min: priceRow.min, max: priceRow.max },
        cities: (citiesRes.rows ?? []).map((r: any) => r.value).filter(Boolean),
        areas: (areasRes.rows ?? []).map((r: any) => r.value).filter(Boolean),
      });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.get("/cars/search", async (req, reply) => {
    const q = (req.query ?? {}) as CarsListQuery;
    const { where, params } = buildWhere(q);
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const limit = clamp(Number(q.limit ?? 20) || 20, 1, 50);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    const orderBy = buildOrder(q.sort ?? "popular");

    try {
      const countRes = await app.db.query(
        `SELECT COUNT(*)::int AS total FROM cars ${whereSql};`,
        params
      );
      const total: number = countRes.rows?.[0]?.total ?? 0;

      const rowsRes = await app.db.query(
        `
        SELECT ${selectBaseFields()}
        FROM cars
        ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset};
        `,
        params
      );

      return reply.send({
        items: (rowsRes.rows ?? []).map(toCarItem),
        page: { limit, offset, total } satisfies PageMeta,
      });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.get("/cars/search/suggest", async (req, reply) => {
    const q = (req.query ?? {}) as Partial<{
      q: string;
      country: string;
      limit: string;
    }>;
    const term = normalizeStr(q.q);
    if (!term) return reply.send({ items: [] });

    const limit = clamp(Number(q.limit ?? 8) || 8, 1, 20);

    const params: unknown[] = [];
    const where: string[] = [`deleted_at IS NULL`, `status = 'active'`];
    let i = 1;

    where.push(
      `(
        LOWER(title) LIKE LOWER($${i}) OR
        LOWER(COALESCE(make,''))  LIKE LOWER($${i}) OR
        LOWER(COALESCE(model,'')) LIKE LOWER($${i}) OR
        LOWER(city)               LIKE LOWER($${i}) OR
        LOWER(COALESCE(area,''))  LIKE LOWER($${i})
      )`
    );
    params.push(`%${term}%`);
    i++;

    const country = normalizeStr(q.country);
    if (country) {
      where.push(`country_code = $${i++}`);
      params.push(country);
    }

    try {
      const sql = `
        SELECT id, title, country_code, city, area
        FROM cars
        WHERE ${where.join(" AND ")}
        ORDER BY is_popular DESC, COALESCE(rating_avg, rating) DESC NULLS LAST, created_at DESC
        LIMIT ${limit};
      `;
      const res = await app.db.query(sql, params);

      return reply.send({
        items: (res.rows ?? []).map((r: any) => ({
          id: String(r.id),
          title: r.title ?? null,
          countryCode: r.country_code ?? null,
          city: r.city ?? null,
          area: normalizeArea(r.area),
          label: [r.title, normalizeStr(r.area), r.city]
            .filter(Boolean)
            .join(" • "),
        })),
      });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.get("/cars/featured", async (req, reply) => {
    const limit = clamp(Number((req.query as any)?.limit ?? 10) || 10, 1, 20);

    try {
      const sql = `
        SELECT ${selectBaseFields()}
        FROM cars
        WHERE deleted_at IS NULL
        AND status = 'active'
        ORDER BY is_featured DESC, is_popular DESC, COALESCE(rating_avg, rating) DESC NULLS LAST, created_at DESC
        LIMIT ${limit};
      `;
      const res = await app.db.query(sql);
      return reply.send({ items: (res.rows ?? []).map(toCarItem) });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.get("/cars/popular", async (req, reply) => {
    const limit = clamp(Number((req.query as any)?.limit ?? 10) || 10, 1, 20);

    try {
      const sql = `
        SELECT ${selectBaseFields()}
        FROM cars
        WHERE deleted_at IS NULL
        AND status = 'active'
        ORDER BY is_popular DESC, COALESCE(rating_avg, rating) DESC NULLS LAST, created_at DESC
        LIMIT ${limit};
      `;
      const res = await app.db.query(sql);
      return reply.send({ items: (res.rows ?? []).map(toCarItem) });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.get("/cars/stats", async (req, reply) => {
    const q = (req.query ?? {}) as Partial<{ country: string; city: string }>;
    const params: unknown[] = [];
    const where: string[] = [`deleted_at IS NULL`];
    let i = 1;

    const country = normalizeStr(q.country);
    const city = normalizeStr(q.city);

    if (country) {
      where.push(`country_code = $${i++}`);
      params.push(country);
    }
    if (city) {
      where.push(`LOWER(city) LIKE LOWER($${i++})`);
      params.push(`%${city}%`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    try {
      const res = await app.db.query(
        `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL)::int AS with_coords,
          COUNT(*) FILTER (WHERE has_image = true AND image_public = true)::int AS with_public_image,
          MIN(price_per_day)::int AS min_price_per_day,
          MAX(price_per_day)::int AS max_price_per_day
        FROM cars
        ${whereSql};
        `,
        params
      );
      return reply.send({ stats: res.rows?.[0] ?? null });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.get("/cars/:id", async (req, reply) => {
    const { id } = req.params as IdParams;
    try {
      const sql = `
        SELECT ${selectBaseFields()}
        FROM cars
        WHERE id = $1 AND deleted_at IS NULL AND status = 'active'
        LIMIT 1;
      `;
      const res = await app.db.query(sql, [id]);
      const car = res.rows?.[0];
      if (!car) {
        return reply
          .code(404)
          .send({ error: "Not Found", message: "Car not found" });
      }
      return reply.send({ item: toCarItem(car) });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  // ---------------------------------------------
  // WRITE routes (protected)
  // ---------------------------------------------

  const preHandler = app.authenticate;

  app.post("/cars", { preHandler }, async (req, reply) => {
    const body = (req.body ?? {}) as CarUpsertBody;

    const patch = sanitizeUpsert(body, true);
    const v = validateUpsertSanitized(patch, true);
    if (!v.ok)
      return reply.code(400).send({ error: "Bad Request", message: v.message });

    try {
      const res = await app.db.query(
        `
        INSERT INTO cars (
          title, vehicle_type, transmission, fuel_type, seats, year,
          currency, price_per_day,

          make, model, trim, body_type,

          country_code, city, area, full_address,

          pickup_lat, pickup_lng,
          pickup_address, pickup_city, pickup_state, pickup_country, pickup_postal_code,

          image_path, image_public, has_image, image_gallery,
          is_popular, is_featured, status,
          features,
          created_at, updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,

          $9,$10,$11,$12,

          $13,$14,$15,$16,

          $17,$18,
          $19,$20,$21,$22,$23,

          $24,$25,$26,$27,
          $28,$29,$30,
          $31,
          NOW(), NOW()
        )
        RETURNING ${selectBaseFields()};
        `,
        [
          patch.title,
          patch.vehicle_type,
          patch.transmission ?? null,
          patch.fuel_type ?? null,
          patch.seats ?? null,
          patch.year ?? null,
          patch.currency ?? null,
          patch.price_per_day ?? null,

          patch.make ?? null,
          patch.model ?? null,
          patch.trim ?? null,
          patch.body_type ?? null,

          patch.country_code,
          patch.city,
          patch.area ?? null,
          patch.full_address ?? null,

          patch.pickup_lat ?? null,
          patch.pickup_lng ?? null,
          patch.pickup_address ?? null,
          patch.pickup_city ?? null,
          patch.pickup_state ?? null,
          patch.pickup_country ?? null,
          patch.pickup_postal_code ?? null,

          patch.image_path ?? null,
          patch.image_public ?? true,
          patch.has_image ?? false,
          patch.image_gallery ?? null,

          patch.is_popular ?? false,
          patch.is_featured ?? false,
          patch.status ?? "draft",

          patch.features ?? {},
        ]
      );

      return reply.code(201).send({ item: toCarItem(res.rows?.[0]) });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.patch("/cars/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as IdParams;
    const body = (req.body ?? {}) as CarUpsertBody;

    const patch = sanitizeUpsert(body, false);
    const v = validateUpsertSanitized(patch, false);
    if (!v.ok)
      return reply.code(400).send({ error: "Bad Request", message: v.message });

    const keys = Object.keys(patch);
    if (!keys.length) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "No fields provided to update",
      });
    }

    // Build dynamic SET for only provided keys
    const set: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    for (const k of keys) {
      set.push(`${k} = $${i++}`);
      params.push((patch as any)[k]);
    }

    set.push(`updated_at = NOW()`);
    params.push(id);

    try {
      const sql = `
        UPDATE cars
        SET ${set.join(", ")}
        WHERE id = $${i++} AND deleted_at IS NULL
        RETURNING ${selectBaseFields()};
      `;

      const res = await app.db.query(sql, params);
      if (!res.rows?.length) {
        return reply
          .code(404)
          .send({ error: "Not Found", message: "Car not found" });
      }
      return reply.send({ item: toCarItem(res.rows[0]) });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  // ✅ publish now denormalizes into real columns too
  app.patch("/cars/:id/publish", { preHandler }, async (req, reply) => {
    const { id } = req.params as IdParams;
    const body = (req.body ?? {}) as any;

    const status = normalizeStr(body?.status);
    if (!status) {
      return reply
        .code(400)
        .send({ error: "Bad Request", message: "status is required" });
    }

    try {
      const currentRes = await app.db.query(
        `SELECT id, features FROM cars WHERE id = $1 AND deleted_at IS NULL LIMIT 1;`,
        [id]
      );
      const current = currentRes.rows?.[0];
      if (!current) {
        return reply
          .code(404)
          .send({ error: "Not Found", message: "Car not found" });
      }

      const incomingFeatures =
        body?.features && isPlainObject(body.features)
          ? body.features
          : undefined;

      const mergedBody = {
        ...body,
        features: incomingFeatures ?? current.features ?? {},
      };

      const den = denormCarColumnsFromBody(mergedBody);

      const res = await app.db.query(
        `
        UPDATE cars
        SET
          status = $1,
          updated_at = NOW(),

          -- keep features if provided, else keep existing
          features = $2::jsonb,

          make = COALESCE($3, make),
          model = COALESCE($4, model),
          trim = COALESCE($5, trim),
          year = COALESCE($6, year),

          body_type = COALESCE($7, body_type),
          fuel_type = COALESCE($8, fuel_type),

          pickup_city = COALESCE($9, pickup_city),
          pickup_state = COALESCE($10, pickup_state),
          pickup_country = COALESCE($11, pickup_country),
          pickup_postal_code = COALESCE($12, pickup_postal_code)

        WHERE id = $13 AND deleted_at IS NULL
        RETURNING ${selectBaseFields()};
        `,
        [
          status,
          JSON.stringify(mergedBody.features ?? {}),

          den.make,
          den.model,
          den.trim,
          den.year,

          den.body_type,
          den.fuel_type,

          den.pickup_city,
          den.pickup_state,
          den.pickup_country,
          den.pickup_postal_code,

          id,
        ]
      );

      if (!res.rows?.length) {
        return reply
          .code(404)
          .send({ error: "Not Found", message: "Car not found" });
      }
      return reply.send({ item: toCarItem(res.rows[0]) });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.delete("/cars/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as IdParams;

    try {
      const res = await app.db.query(
        `
        UPDATE cars
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id;
        `,
        [id]
      );

      if (!res.rows?.length) {
        return reply
          .code(404)
          .send({ error: "Not Found", message: "Car not found" });
      }

      return reply.send({ ok: true, id });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.post("/cars/:id/restore", { preHandler }, async (req, reply) => {
    const { id } = req.params as IdParams;

    try {
      const res = await app.db.query(
        `
        UPDATE cars
        SET deleted_at = NULL, updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NOT NULL
        RETURNING ${selectBaseFields()};
        `,
        [id]
      );

      if (!res.rows?.length) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Car not found or not deleted",
        });
      }

      return reply.send({ item: toCarItem(res.rows[0]) });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });
};

export default carsRoutes;

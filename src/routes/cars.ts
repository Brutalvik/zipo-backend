import type { FastifyPluginAsync } from "fastify";

// -------------------------------------------------------------------------------------
// Cars routes (Fastify + PostgreSQL)
//
// Notes / design goals:
// - Backend DB is source of truth.
// - All list/map/search queries filter out soft-deleted rows via deleted_at IS NULL.
// - Additive response fields only (safe for clients).
// - READ routes are public for browsing.
// - WRITE routes require Firebase auth via `app.authenticate` and use `req.authUser`.
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

    // ✅ optional radius mode
    lat: string;
    lng: string;
    radiusKm: string; // 1..50
  }>;

type IdParams = { id: string };

type CarRow = Record<string, unknown>;

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

function toInt(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

function toNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n;
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

function mediaBase() {
  return process.env.MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, "");
}

function computeImageUrl(row: any) {
  const base = mediaBase();
  const placeholder = base ? `${base}/cars/placeholder-car.jpg` : undefined;

  const has = !!row?.has_image;
  const isPublic = row?.image_public !== false; // default true
  const path = row?.image_path ? String(row.image_path) : "";

  if (base && has && isPublic && path) return `${base}/${path}`;
  return placeholder ?? null;
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

    // NEW (will be present for /cars/map when lat/lng/radiusKm are provided)
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

  // Always exclude soft-deleted
  where.push(`deleted_at IS NULL`);

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

  const seats = toInt(q.seats);
  if (seats != null) {
    where.push(`seats = $${i++}`);
    params.push(seats);
  }

  let yearMin = toInt(q.yearMin);
  let yearMax = toInt(q.yearMax);
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

  // swap min/max if reversed
  let minPrice = toNum(q.minPrice);
  let maxPrice = toNum(q.maxPrice);
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

  // hasImage=true should mean has_image AND image_public
  if (q.hasImage === "true")
    where.push(`has_image = true AND image_public = true`);
  if (q.hasImage === "false") where.push(`has_image = false`);

  // Search term
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
  // Keep SELECT list stable and additive.
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
    updated_at
  `;
}

function asBool(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  if (typeof v !== "string") return undefined;
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  return undefined;
}

function validateUpsert(body: CarUpsertBody, isCreate: boolean) {
  const title = normalizeStr(body.title);
  const vehicleType = normalizeStr(body.vehicle_type);
  const countryCode = normalizeStr(body.country_code);
  const city = normalizeStr(body.city);

  if (isCreate) {
    if (!title || !vehicleType || !countryCode || !city) {
      return {
        ok: false as const,
        message: "title, vehicle_type, country_code, and city are required",
      };
    }
  }

  if (body.price_per_day != null) {
    const n = Number(body.price_per_day);
    if (!Number.isFinite(n) || n < 0) {
      return {
        ok: false as const,
        message: "price_per_day must be a positive number",
      };
    }
  }

  if (body.seats != null) {
    const n = Number(body.seats);
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      return { ok: false as const, message: "seats must be between 1 and 20" };
    }
  }

  if (body.year != null) {
    const n = Number(body.year);
    const thisYear = new Date().getFullYear() + 1;
    if (!Number.isFinite(n) || n < 1950 || n > thisYear) {
      return {
        ok: false as const,
        message: `year must be between 1950 and ${thisYear}`,
      };
    }
  }

  const imagePublic = asBool(body.image_public);
  if (body.image_public != null && imagePublic == null) {
    return { ok: false as const, message: "image_public must be boolean" };
  }

  const hasImage = asBool(body.has_image);
  if (body.has_image != null && hasImage == null) {
    return { ok: false as const, message: "has_image must be boolean" };
  }

  return { ok: true as const };
}

// -------------------------------------------------------------------------------------
// WRITE types
// -------------------------------------------------------------------------------------

type CarUpsertBody = Partial<{
  title: string;
  vehicle_type: string;
  transmission: string;
  fuel_type: string;
  seats: number;
  year: number;
  currency: string;
  price_per_day: number;
  country_code: string;
  city: string;
  area: string;
  full_address: string;
  pickup_lat: number;
  pickup_lng: number;
  image_path: string;
  image_public: boolean;
  has_image: boolean;
  image_gallery: unknown[];
  is_popular: boolean;
  is_featured: boolean;
  status: CarStatus;
}>;

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

    const minLat = toNum(q.minLat);
    const maxLat = toNum(q.maxLat);
    const minLng = toNum(q.minLng);
    const maxLng = toNum(q.maxLng);

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

    // ✅ optional radius inputs
    const lat = toNum(q.lat);
    const lng = toNum(q.lng);
    const radiusKmRaw = toNum(q.radiusKm);
    const hasRadius = lat != null && lng != null && radiusKmRaw != null;
    const radiusKm = hasRadius ? clamp(radiusKmRaw!, 1, 50) : undefined;

    const { where, params } = buildWhere(q);

    let i = params.length + 1;

    // must have coords for map
    where.push(`pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL`);

    // bbox filter (existing)
    where.push(`pickup_lat BETWEEN $${i++} AND $${i++}`);
    (params as any[]).push(minLat, maxLat);

    where.push(`pickup_lng BETWEEN $${i++} AND $${i++}`);
    (params as any[]).push(minLng, maxLng);

    // Default map to active if not specified
    if (!normalizeStr(q.status)) where.push(`status = 'active'`);

    // ✅ radius filter (only when provided)
    // Note: ST_MakePoint expects (lng, lat)
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

      // nearest-first (then your sort)
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
    const where: string[] = [`deleted_at IS NULL`];

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
    const where: string[] = [`deleted_at IS NULL`];
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
        WHERE id = $1 AND deleted_at IS NULL
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

  app.get("/cars/:id/similar", async (req, reply) => {
    const { id } = req.params as IdParams;
    const limit = clamp(Number((req.query as any)?.limit ?? 8) || 8, 1, 20);

    try {
      const baseRes = await app.db.query(
        `SELECT id, country_code, vehicle_type FROM cars WHERE id = $1 AND deleted_at IS NULL LIMIT 1;`,
        [id]
      );
      const base = baseRes.rows?.[0];
      if (!base) {
        return reply
          .code(404)
          .send({ error: "Not Found", message: "Car not found" });
      }

      const sql = `
        SELECT ${selectBaseFields()}
        FROM cars
        WHERE deleted_at IS NULL
          AND id <> $1
          AND country_code = $2
          AND vehicle_type = $3
        ORDER BY is_popular DESC, COALESCE(rating_avg, rating) DESC NULLS LAST, created_at DESC
        LIMIT ${limit};
      `;
      const res = await app.db.query(sql, [
        id,
        base.country_code,
        base.vehicle_type,
      ]);
      if (res.rows?.length)
        return reply.send({ items: res.rows.map(toCarItem) });

      // Fallback: same country
      const fb = await app.db.query(
        `
        SELECT ${selectBaseFields()}
        FROM cars
        WHERE deleted_at IS NULL
          AND id <> $1
          AND country_code = $2
        ORDER BY is_popular DESC, COALESCE(rating_avg, rating) DESC NULLS LAST, created_at DESC
        LIMIT ${limit};
        `,
        [id, base.country_code]
      );
      return reply.send({ items: (fb.rows ?? []).map(toCarItem) });
    } catch (err) {
      return sendDbError(reply, err);
    }
  });

  app.get("/cars/:id/availability", async (req, reply) => {
    const { id } = req.params as IdParams;
    const q = (req.query ?? {}) as Partial<{ start: string; end: string }>;

    const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if ((q.start && !isDate(q.start)) || (q.end && !isDate(q.end))) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "start/end must be YYYY-MM-DD",
      });
    }
    if (q.start && q.end && q.start > q.end) {
      return reply
        .code(400)
        .send({ error: "Bad Request", message: "start must be <= end" });
    }

    try {
      const exists = await app.db.query(
        `SELECT 1 FROM cars WHERE id = $1 AND deleted_at IS NULL LIMIT 1;`,
        [id]
      );
      if (!exists.rows?.length) {
        return reply
          .code(404)
          .send({ error: "Not Found", message: "Car not found" });
      }

      // TODO: join bookings / calendar blocks when those tables exist.
      return reply.send({
        carId: id,
        start: q.start ?? null,
        end: q.end ?? null,
        available: true,
        blockedDates: [],
      });
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

    const v = validateUpsert(body, true);
    if (!v.ok)
      return reply.code(400).send({ error: "Bad Request", message: v.message });

    const title = normalizeStr(body.title)!;
    const vehicleType = normalizeStr(body.vehicle_type)!;
    const countryCode = normalizeStr(body.country_code)!;
    const city = normalizeStr(body.city)!;

    // Future-proof: when you add owner/host columns, bind req.authUser.uid here.
    // const ownerFirebaseUid = req.authUser.uid;

    try {
      const res = await app.db.query(
        `
        INSERT INTO cars (
          title, vehicle_type, transmission, fuel_type, seats, year,
          currency, price_per_day,
          country_code, city, area, full_address,
          pickup_lat, pickup_lng,
          image_path, image_public, has_image, image_gallery,
          is_popular, is_featured, status,
          created_at, updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,
          $9,$10,$11,$12,
          $13,$14,
          $15,$16,$17,$18,
          $19,$20,$21,
          NOW(), NOW()
        )
        RETURNING ${selectBaseFields()};
        `,
        [
          title,
          vehicleType,
          body.transmission ?? null,
          body.fuel_type ?? null,
          body.seats ?? null,
          body.year ?? null,
          body.currency ?? null,
          body.price_per_day ?? null,
          countryCode,
          city,
          body.area ?? null,
          body.full_address ?? null,
          body.pickup_lat ?? null,
          body.pickup_lng ?? null,
          body.image_path ?? null,
          body.image_public ?? true,
          body.has_image ?? false,
          body.image_gallery ?? null,
          body.is_popular ?? false,
          body.is_featured ?? false,
          body.status ?? "draft",
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

    const v = validateUpsert(body, false);
    if (!v.ok)
      return reply.code(400).send({ error: "Bad Request", message: v.message });

    const set: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    const allow = (col: keyof CarUpsertBody, dbCol = col) => {
      if ((body as any)[col] === undefined) return;
      set.push(`${String(dbCol)} = $${i++}`);
      params.push((body as any)[col]);
    };

    allow("title");
    allow("vehicle_type");
    allow("transmission");
    allow("fuel_type");
    allow("seats");
    allow("year");
    allow("currency");
    allow("price_per_day");
    allow("country_code");
    allow("city");
    allow("area");
    allow("full_address");
    allow("pickup_lat");
    allow("pickup_lng");
    allow("image_path");
    allow("image_public");
    allow("has_image");
    allow("image_gallery");
    allow("is_popular");
    allow("is_featured");
    allow("status");

    if (!set.length) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "No fields provided to update",
      });
    }

    set.push(`updated_at = NOW()`);

    try {
      const sql = `
        UPDATE cars
        SET ${set.join(", ")}
        WHERE id = $${i++} AND deleted_at IS NULL
        RETURNING ${selectBaseFields()};
      `;
      params.push(id);

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

  app.patch("/cars/:id/publish", { preHandler }, async (req, reply) => {
    const { id } = req.params as IdParams;
    const body = (req.body ?? {}) as Partial<{ status: CarStatus }>;
    const status = normalizeStr(body.status);

    if (!status) {
      return reply
        .code(400)
        .send({ error: "Bad Request", message: "status is required" });
    }

    try {
      const res = await app.db.query(
        `
        UPDATE cars
        SET status = $1, updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL
        RETURNING ${selectBaseFields()};
        `,
        [status, id]
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

  // Soft delete
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

  // Restore soft-deleted car (admin/host tool)
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

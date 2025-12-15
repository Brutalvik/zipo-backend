import type { FastifyPluginAsync } from "fastify";

type CarsQuery = Partial<{
  country: string; // "CA" | "ID" | "IN" (in your case, still fine if you keep it)
  city: string;
  area: string;
  type: string;
  transmission: string;
  seats: string;
  minPrice: string;
  maxPrice: string;
  hasImage: string; // "true" | "false"
  limit: string;
  offset: string;
}>;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function mediaBase() {
  return process.env.MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, "");
}

function normalizeArea(area: any) {
  if (area == null) return undefined;
  const s = String(area).trim();
  return s.length ? s : undefined;
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

function toCarItem(row: any) {
  return {
    id: row.id,
    title: row.title,
    vehicleType: row.vehicle_type,
    transmission: row.transmission,
    seats: row.seats,
    pricePerDay: row.price_per_day,
    rating: row.rating == null ? null : Number(row.rating),
    reviews: row.reviews,
    address: {
      countryCode: row.country_code,
      city: row.city,
      area: normalizeArea(row.area),
      fullAddress: row.full_address,
    },
    hasImage: !!row.has_image,
    imagePublic: row.image_public !== false,
    imagePath: row.image_path,
    imageUrl: computeImageUrl(row),
    isPopular: !!row.is_popular,
    createdAt: row.created_at,
  };
}

export default (async function carsRoutes(app) {
  /**
   * GET /api/cars
   */
  app.get("/cars", async (req, reply) => {
    const q = req.query as CarsQuery;

    const where: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (q.country) {
      where.push(`country_code = $${i++}`);
      params.push(q.country);
    }
    if (q.city) {
      where.push(`LOWER(city) LIKE LOWER($${i++})`);
      params.push(`%${q.city}%`);
    }
    if (q.area) {
      where.push(`LOWER(COALESCE(area,'')) LIKE LOWER($${i++})`);
      params.push(`%${q.area}%`);
    }
    if (q.type) {
      where.push(`vehicle_type = $${i++}`);
      params.push(q.type);
    }
    if (q.transmission) {
      where.push(`transmission = $${i++}`);
      params.push(q.transmission);
    }

    if (q.seats) {
      const seats = Number(q.seats);
      if (!Number.isNaN(seats)) {
        where.push(`seats = $${i++}`);
        params.push(seats);
      }
    }

    // swap min/max if reversed
    let minPrice = q.minPrice ? Number(q.minPrice) : undefined;
    let maxPrice = q.maxPrice ? Number(q.maxPrice) : undefined;
    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      !Number.isNaN(minPrice) &&
      !Number.isNaN(maxPrice) &&
      minPrice > maxPrice
    ) {
      [minPrice, maxPrice] = [maxPrice, minPrice];
    }

    if (minPrice !== undefined && !Number.isNaN(minPrice)) {
      where.push(`price_per_day >= $${i++}`);
      params.push(minPrice);
    }
    if (maxPrice !== undefined && !Number.isNaN(maxPrice)) {
      where.push(`price_per_day <= $${i++}`);
      params.push(maxPrice);
    }

    // IMPORTANT: "hasImage=true" should mean "has_image AND image_public"
    if (q.hasImage === "true")
      where.push(`has_image = true AND image_public = true`);
    if (q.hasImage === "false") where.push(`has_image = false`);

    const limit = clamp(Number(q.limit ?? 20) || 20, 1, 50);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countSql = `SELECT COUNT(*)::int AS total FROM cars ${whereSql};`;
    const countRes = await app.db.query(countSql, params);
    const total = countRes.rows?.[0]?.total ?? 0;

    const rowsSql = `
      SELECT
        id, title, vehicle_type, transmission, seats, price_per_day, rating, reviews,
        country_code, city, area, full_address,
        image_path, has_image, image_public,
        is_popular, created_at
      FROM cars
      ${whereSql}
      ORDER BY is_popular DESC, rating DESC NULLS LAST, created_at DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const { rows } = await app.db.query(rowsSql, params);

    return reply.send({
      items: rows.map(toCarItem),
      page: { limit, offset, total },
    });
  });

  /**
   * GET /cars/:id
   */
  app.get("/cars/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const sql = `
      SELECT
        id, title, vehicle_type, transmission, seats, price_per_day, rating, reviews,
        country_code, city, area, full_address,
        image_path, has_image, image_public,
        is_popular, created_at
      FROM cars
      WHERE id = $1
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
  });

  /**
   * GET /cars/filters?country=CA
   * (country param is optional; you can keep it or remove it since DB is per-country)
   */
  app.get("/cars/filters", async (req, reply) => {
    const q = (req.query ?? {}) as Partial<{ country: string }>;

    const params: any[] = [];
    let whereSql = "";

    // if you want to ignore country entirely (per-country DB), just delete this block
    if (q.country) {
      params.push(q.country);
      whereSql = `WHERE country_code = $1`;
    }

    const [typesRes, transRes, seatsRes, priceRes, citiesRes, areasRes] =
      await Promise.all([
        app.db.query(
          `SELECT DISTINCT vehicle_type AS value FROM cars ${whereSql} ORDER BY value ASC;`,
          params
        ),
        app.db.query(
          `SELECT DISTINCT transmission AS value FROM cars ${whereSql} ORDER BY value ASC;`,
          params
        ),
        app.db.query(
          `SELECT DISTINCT seats AS value FROM cars ${whereSql} ORDER BY value ASC;`,
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
        // Only non-empty areas
        app.db.query(
          `
          SELECT DISTINCT area AS value
          FROM cars
          ${whereSql ? `${whereSql} AND` : "WHERE"}
            area IS NOT NULL AND TRIM(area) <> ''
          ORDER BY value ASC;
          `,
          params
        ),
      ]);

    const priceRow = priceRes.rows?.[0] ?? { min: null, max: null };

    return reply.send({
      country: q.country ?? null,
      vehicleTypes: typesRes.rows.map((r: any) => r.value),
      transmissions: transRes.rows.map((r: any) => r.value),
      seats: seatsRes.rows.map((r: any) => Number(r.value)),
      pricePerDay: { min: priceRow.min, max: priceRow.max },
      cities: citiesRes.rows.map((r: any) => r.value),
      areas: areasRes.rows.map((r: any) => r.value),
    });
  });

  /**
   * GET /cars/search/suggest?q=&country=
   */
  app.get("/cars/search/suggest", async (req, reply) => {
    const q = (req.query ?? {}) as Partial<{
      q: string;
      country: string;
      limit: string;
    }>;
    const term = (q.q ?? "").trim();
    if (!term) return reply.send({ items: [] });

    const limit = clamp(Number(q.limit ?? 8) || 8, 1, 20);

    const params: any[] = [];
    let i = 1;

    let where = `(
      LOWER(title) LIKE LOWER($${i}) OR
      LOWER(city)  LIKE LOWER($${i}) OR
      LOWER(COALESCE(area,'')) LIKE LOWER($${i})
    )`;
    params.push(`%${term}%`);
    i++;

    // optional country (you can remove if DB is per-country)
    if (q.country) {
      where += ` AND country_code = $${i++}`;
      params.push(q.country);
    }

    const sql = `
      SELECT id, title, country_code, city, area
      FROM cars
      WHERE ${where}
      ORDER BY is_popular DESC, rating DESC NULLS LAST, created_at DESC
      LIMIT ${limit};
    `;

    const res = await app.db.query(sql, params);

    return reply.send({
      items: res.rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        countryCode: r.country_code,
        city: r.city,
        area: normalizeArea(r.area) ?? null,
        label: [r.title, normalizeArea(r.area), r.city]
          .filter(Boolean)
          .join(" • "),
      })),
    });
  });

  /**
   * GET /cars/:id/similar
   */
  app.get("/cars/:id/similar", async (req, reply) => {
    const { id } = req.params as { id: string };
    const limit = clamp(Number((req.query as any)?.limit ?? 8) || 8, 1, 20);

    const baseRes = await app.db.query(
      `SELECT id, country_code, vehicle_type FROM cars WHERE id = $1 LIMIT 1;`,
      [id]
    );
    const base = baseRes.rows?.[0];
    if (!base)
      return reply
        .code(404)
        .send({ error: "Not Found", message: "Car not found" });

    const sql = `
      SELECT
        id, title, vehicle_type, transmission, seats, price_per_day, rating, reviews,
        country_code, city, area, full_address,
        image_path, has_image, image_public,
        is_popular, created_at
      FROM cars
      WHERE id <> $1
        AND country_code = $2
        AND vehicle_type = $3
      ORDER BY is_popular DESC, rating DESC NULLS LAST, created_at DESC
      LIMIT ${limit};
    `;
    const res = await app.db.query(sql, [
      id,
      base.country_code,
      base.vehicle_type,
    ]);

    if (!res.rows.length) {
      const fallbackSql = `
        SELECT
          id, title, vehicle_type, transmission, seats, price_per_day, rating, reviews,
          country_code, city, area, full_address,
          image_path, has_image, image_public,
          is_popular, created_at
        FROM cars
        WHERE id <> $1
          AND country_code = $2
        ORDER BY is_popular DESC, rating DESC NULLS LAST, created_at DESC
        LIMIT ${limit};
      `;
      const fb = await app.db.query(fallbackSql, [id, base.country_code]);
      return reply.send({ items: fb.rows.map(toCarItem) });
    }

    return reply.send({ items: res.rows.map(toCarItem) });
  });

  /**
   * GET /cars/:id/availability?start=YYYY-MM-DD&end=YYYY-MM-DD
   * STUB until bookings table exists
   */
  app.get("/cars/:id/availability", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = (req.query ?? {}) as Partial<{ start: string; end: string }>;

    const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

    if ((q.start && !isDate(q.start)) || (q.end && !isDate(q.end))) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "start/end must be YYYY-MM-DD",
      });
    }
    if (q.start && q.end && q.start > q.end) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "start must be <= end",
      });
    }

    const exists = await app.db.query(
      `SELECT 1 FROM cars WHERE id = $1 LIMIT 1;`,
      [id]
    );
    if (!exists.rows.length) {
      return reply
        .code(404)
        .send({ error: "Not Found", message: "Car not found" });
    }

    return reply.send({
      carId: id,
      start: q.start ?? null,
      end: q.end ?? null,
      available: true,
      blockedDates: [],
    });
  });

  /**
   * OPTIONAL (nice for home screen):
   * GET /cars/featured?limit=10
   */
  app.get("/cars/featured", async (req, reply) => {
    const limit = clamp(Number((req.query as any)?.limit ?? 10) || 10, 1, 20);

    const sql = `
      SELECT
        id, title, vehicle_type, transmission, seats, price_per_day, rating, reviews,
        country_code, city, area, full_address,
        image_path, has_image, image_public,
        is_popular, created_at
      FROM cars
      ORDER BY is_popular DESC, rating DESC NULLS LAST, created_at DESC
      LIMIT ${limit};
    `;

    const res = await app.db.query(sql);
    return reply.send({ items: res.rows.map(toCarItem) });
  });
} satisfies FastifyPluginAsync);

import type { FastifyPluginAsync } from "fastify";

/**
 * User routes
 * All routes are scoped to the authenticated user via Firebase UID.
 * NO userId is ever passed from the client.
 *
 * Auth: uses app.authenticate (Firebase Admin verifyIdToken)
 * - Preferred: req.authUser
 * - Legacy fallback: (req as any).user (runtime only, for older code paths)
 */

function getAuth(req: any): { uid: string; raw: any } | null {
  if (req.authUser?.uid)
    return { uid: String(req.authUser.uid), raw: req.authUser };
  const legacy = req.user;
  if (legacy?.uid) return { uid: String(legacy.uid), raw: legacy };
  return null;
}

function normalizeEmail(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  return s;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhoneE164(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s;
}

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function parseDob(dob: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d))
    return null;

  const dt = new Date(y, mo - 1, d);
  const isValid =
    dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;

  if (!isValid) return null;

  return { y, m: mo, d };
}

function isValidDob(dob: string): boolean {
  return parseDob(dob) != null;
}

function isAtLeast18(dob: string): boolean {
  const parts = parseDob(dob);
  if (!parts) return false;

  const { y, m, d } = parts;

  // UTC compare avoids timezone edge cases
  const dobPlus18 = Date.UTC(y + 18, m - 1, d);

  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  return dobPlus18 <= todayUtc;
}

function getTokenEmailVerified(raw: any): boolean {
  // Firebase decoded token can have email_verified or (in our mapping) emailVerified
  return raw?.email_verified === true || raw?.emailVerified === true;
}

function getTokenEmail(raw: any): string | null {
  return normalizeEmail(raw?.email);
}

function getTokenPhone(raw: any): string | null {
  const p =
    raw?.phone_number ??
    raw?.phoneNumber ??
    raw?.phone ??
    raw?.phone_e164 ??
    null;
  return normalizePhoneE164(p);
}

const userRoutes: FastifyPluginAsync = async (app) => {
  /**
   * ----------------------------------------------------
   * GET /users/me
   * ----------------------------------------------------
   */
  app.get("/users/me", { preHandler: app.authenticate }, async (req, reply) => {
    const auth = getAuth(req);
    if (!auth) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Invalid auth context",
      });
    }

    try {
      const { rows } = await app.db.query(
        `
        SELECT
          id,
          firebase_uid,
          email,
          full_name,
          profile_photo_url,
          phone_e164,
          phone_pending_e164,
          phone_verified,
          email_verified,
          mode,
          status,
          kyc_status,
          address,
          preferences,
          date_of_birth,
          created_at,
          updated_at
        FROM users
        WHERE firebase_uid = $1
        LIMIT 1
        `,
        [auth.uid]
      );

      if (!rows[0]) return reply.code(404).send({ error: "User not found" });
      return reply.send({ user: rows[0] });
    } catch (e: any) {
      req.log.error({ err: e }, "GET /users/me failed");
      return reply.code(500).send({
        error: "INTERNAL_ERROR",
        message: "Failed to load profile. Please try again.",
      });
    }
  });

  /**
   * ----------------------------------------------------
   * PATCH /users/me  (single endpoint for profile edits)
   * ----------------------------------------------------
   * Supports:
   *  - full_name (may be blocked by DB trigger if immutable)
   *  - date_of_birth (set-once) + backend validates 18+
   *  - email (resets email_verified=false if changed)
   *  - phone_e164 -> stored as phone_pending_e164 (resets phone_verified=false) until verified
   */
  app.patch(
    "/users/me",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) {
        return reply.code(401).send({
          error: "Unauthorized",
          message: "Invalid auth context",
        });
      }

      const body = (req.body ?? {}) as {
        full_name?: string;
        date_of_birth?: string; // YYYY-MM-DD
        email?: string;
        phone_e164?: string; // desired new phone (goes pending)
      };

      const full_name =
        typeof body.full_name === "string" ? body.full_name.trim() : undefined;

      const dob =
        typeof body.date_of_birth === "string"
          ? body.date_of_birth.trim()
          : undefined;

      const email =
        typeof body.email === "string"
          ? body.email.trim().toLowerCase()
          : undefined;

      const phone_e164 =
        typeof body.phone_e164 === "string"
          ? body.phone_e164.trim()
          : undefined;

      // --------------------
      // Validate only if provided
      // --------------------
      if (full_name !== undefined) {
        if (!full_name) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: "Full name is required.",
          });
        }
        if (full_name.length < 2) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: "Full name must be at least 2 characters.",
          });
        }
        if (full_name.length > 120) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: "Full name is too long.",
          });
        }
      }

      if (email !== undefined) {
        if (!isValidEmail(email)) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: "Please enter a valid email address.",
          });
        }
      }

      if (phone_e164 !== undefined) {
        if (!isValidE164(phone_e164)) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: "Phone must be a valid E.164 number (e.g. +14165551234).",
          });
        }
      }

      if (dob !== undefined) {
        if (!isValidDob(dob)) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: "Date of birth must be a valid date in YYYY-MM-DD format.",
          });
        }
        // ✅ backend guard
        if (!isAtLeast18(dob)) {
          return reply.code(400).send({
            error: "VALIDATION_ERROR",
            message: "You must be at least 18 years old.",
          });
        }
      }

      // --------------------
      // No-op guard
      // --------------------
      if (
        full_name === undefined &&
        dob === undefined &&
        email === undefined &&
        phone_e164 === undefined
      ) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "No updates provided.",
        });
      }

      try {
        // Fetch current values to decide resets + pending logic
        const existing = await app.db.query(
          `
        SELECT email, phone_e164, phone_pending_e164
        FROM users
        WHERE firebase_uid = $1
        LIMIT 1
        `,
          [auth.uid]
        );

        if (!existing.rows[0]) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "User not found.",
          });
        }

        const currentEmail: string | null = existing.rows[0].email ?? null;
        const currentPhone: string | null = existing.rows[0].phone_e164 ?? null;
        const currentPending: string | null =
          existing.rows[0].phone_pending_e164 ?? null;

        const emailChanged =
          email !== undefined && email !== (currentEmail ?? "").toLowerCase();

        // If there is already a pending number, compare against it first
        const comparePhone = String(
          currentPending ?? currentPhone ?? ""
        ).trim();
        const phoneChanged =
          phone_e164 !== undefined && phone_e164 !== comparePhone;

        // Avoid setting pending to same as verified phone
        const effectivePhoneChanged =
          phoneChanged &&
          !(
            phone_e164 !== undefined &&
            currentPhone != null &&
            phone_e164 === String(currentPhone).trim()
          );

        const { rows } = await app.db.query(
          `
        UPDATE users
        SET
          -- full name (may be blocked by your trigger; caught below)
          full_name = COALESCE($2, full_name),

          -- email + reset verification if changed
          email = COALESCE($3, email),
          email_verified = CASE WHEN $4::boolean = true THEN false ELSE email_verified END,

          -- phone: pending until verified, and reset phone_verified when changed
          phone_pending_e164 = CASE WHEN $5::boolean = true THEN $6 ELSE phone_pending_e164 END,
          phone_verified = CASE WHEN $5::boolean = true THEN false ELSE phone_verified END,

          -- DOB set-once
          date_of_birth = CASE
            WHEN $7::date IS NULL THEN date_of_birth
            WHEN date_of_birth IS NULL THEN $7::date
            ELSE date_of_birth
          END,

          updated_at = now()
        WHERE firebase_uid = $1
        RETURNING
          id,
          firebase_uid,
          email,
          full_name,
          profile_photo_url,
          phone_e164,
          phone_pending_e164,
          phone_verified,
          email_verified,
          mode,
          status,
          kyc_status,
          address,
          preferences,
          date_of_birth,
          created_at,
          updated_at
        `,
          [
            auth.uid,
            full_name ?? null,
            email ?? null,
            emailChanged,
            effectivePhoneChanged,
            phone_e164 ?? null,
            dob ?? null,
          ]
        );

        if (!rows[0]) {
          return reply.code(404).send({
            error: "NOT_FOUND",
            message: "User not found.",
          });
        }

        return reply.send({ user: rows[0] });
      } catch (e: any) {
        if (
          e?.code === "P0001" &&
          String(e?.message || "")
            .toLowerCase()
            .includes("full_name is immutable")
        ) {
          return reply.code(409).send({
            error: "FULL_NAME_IMMUTABLE",
            message:
              "Your name can’t be changed once it’s set. Contact support if you need a correction.",
          });
        }

        if (
          e?.code === "P0001" &&
          String(e?.message || "")
            .toLowerCase()
            .includes("date_of_birth")
        ) {
          return reply.code(409).send({
            error: "DOB_IMMUTABLE",
            message: "Date of birth can’t be changed once it’s set.",
          });
        }

        req.log.error({ err: e }, "PATCH /users/me failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message:
            "Something went wrong while saving your profile. Please try again.",
        });
      }
    }
  );

  /**
   * ----------------------------------------------------
   * PATCH /users/email/sync
   * ----------------------------------------------------
   * Sync email + email_verified from Firebase token -> DB
   * Client sends nothing except Authorization header
   */
  app.patch(
    "/users/email/sync",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) {
        return reply.code(401).send({
          error: "Unauthorized",
          message: "Invalid auth context",
        });
      }

      const email = getTokenEmail(auth.raw);
      const verified = getTokenEmailVerified(auth.raw);

      if (!email) {
        return reply.code(400).send({
          error: "NO_FIREBASE_EMAIL",
          message: "Firebase user has no email.",
        });
      }

      try {
        const { rows } = await app.db.query(
          `
          UPDATE users
          SET
            email = $2,
            email_verified = $3,
            updated_at = now()
          WHERE firebase_uid = $1
          RETURNING
            id,
            firebase_uid,
            email,
            full_name,
            profile_photo_url,
            phone_e164,
            phone_pending_e164,
            phone_verified,
            email_verified,
            mode,
            status,
            kyc_status,
            address,
            preferences,
            date_of_birth,
            created_at,
            updated_at
          `,
          [auth.uid, email, verified]
        );

        if (!rows[0]) return reply.code(404).send({ error: "User not found" });
        return reply.send({ user: rows[0] });
      } catch (e: any) {
        req.log.error({ err: e }, "PATCH /users/email/sync failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to sync email. Please try again.",
        });
      }
    }
  );

  /**
   * ----------------------------------------------------
   * PATCH /users/phone/sync
   * ----------------------------------------------------
   * Sync VERIFIED phone from Firebase token -> DB
   * Also clears phone_pending_e164
   * Client sends nothing except Authorization header
   */
  app.patch(
    "/users/phone/sync",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const auth = getAuth(req);
      if (!auth) {
        return reply.code(401).send({
          error: "Unauthorized",
          message: "Invalid auth context",
        });
      }

      const phone = getTokenPhone(auth.raw);

      if (!phone) {
        return reply.code(400).send({
          error: "NO_FIREBASE_PHONE",
          message: "Firebase user has no verified phone number",
        });
      }

      if (!isValidE164(phone)) {
        return reply.code(400).send({
          error: "INVALID_FIREBASE_PHONE",
          message: "Firebase phone number is not a valid E.164 number",
        });
      }

      try {
        const { rows } = await app.db.query(
          `
          UPDATE users
          SET
            phone_e164 = $2,
            phone_pending_e164 = NULL,
            phone_verified = true,
            updated_at = now()
          WHERE firebase_uid = $1
          RETURNING
            id,
            firebase_uid,
            email,
            full_name,
            profile_photo_url,
            phone_e164,
            phone_pending_e164,
            phone_verified,
            email_verified,
            mode,
            status,
            kyc_status,
            address,
            preferences,
            date_of_birth,
            created_at,
            updated_at
          `,
          [auth.uid, phone]
        );

        if (!rows[0]) return reply.code(404).send({ error: "User not found" });
        return reply.send({ user: rows[0] });
      } catch (e: any) {
        req.log.error({ err: e }, "PATCH /users/phone/sync failed");
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Failed to sync phone. Please try again.",
        });
      }
    }
  );
};

export default userRoutes;

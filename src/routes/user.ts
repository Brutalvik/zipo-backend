import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../middleware/requireAuth.js";

/**
 * User routes
 * All routes are scoped to the authenticated user via Firebase UID.
 * NO userId is ever passed from the client.
 */
const userRoutes: FastifyPluginAsync = async (app) => {
  /**
   * ----------------------------------------------------
   * GET /users/me
   * ----------------------------------------------------
   */
  app.get("/users/me", { preHandler: requireAuth }, async (req, reply) => {
    const u = req.user as { uid: string };

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
      [u.uid]
    );

    if (!rows[0]) return reply.code(404).send({ error: "User not found" });
    return reply.send({ user: rows[0] });
  });

  /**
   * ----------------------------------------------------
   * PATCH /users/me  (single endpoint for profile edits)
   * ----------------------------------------------------
   * Supports:
   *  - full_name (may be blocked by DB trigger if immutable)
   *  - date_of_birth (set-once)
   *  - email (resets email_verified=false if changed)
   *  - phone_e164 -> stored as phone_pending_e164 (resets phone_verified=false) until verified
   */
  app.patch("/users/me", { preHandler: requireAuth }, async (req, reply) => {
    const u = req.user as { uid: string };

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
      typeof body.phone_e164 === "string" ? body.phone_e164.trim() : undefined;

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
    }

    if (email !== undefined) {
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!ok) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "Please enter a valid email address.",
        });
      }
    }

    if (phone_e164 !== undefined) {
      const ok = /^\+[1-9]\d{7,14}$/.test(phone_e164);
      if (!ok) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "Phone must be a valid E.164 number (e.g. +14165551234).",
        });
      }
    }

    if (dob !== undefined) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
      if (!m) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "Date of birth must be in YYYY-MM-DD format.",
        });
      }
      const yy = Number(m[1]);
      const mm = Number(m[2]);
      const dd = Number(m[3]);
      const dt = new Date(yy, mm - 1, dd);
      const isValid =
        dt.getFullYear() === yy &&
        dt.getMonth() === mm - 1 &&
        dt.getDate() === dd;
      if (!isValid) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "Invalid date of birth.",
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
      return reply
        .code(400)
        .send({ error: "VALIDATION_ERROR", message: "No updates provided." });
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
        [u.uid]
      );

      if (!existing.rows[0]) {
        return reply
          .code(404)
          .send({ error: "NOT_FOUND", message: "User not found." });
      }

      const currentEmail: string | null = existing.rows[0].email ?? null;
      const currentPhone: string | null = existing.rows[0].phone_e164 ?? null;
      const currentPending: string | null =
        existing.rows[0].phone_pending_e164 ?? null;

      const emailChanged =
        email !== undefined && email !== (currentEmail ?? "").toLowerCase();

      // If there is already a pending number, compare against it first
      const comparePhone = currentPending ?? currentPhone ?? "";
      const phoneChanged =
        phone_e164 !== undefined && phone_e164 !== String(comparePhone);

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
          u.uid,
          full_name ?? null,
          email ?? null,
          emailChanged,
          phoneChanged,
          phone_e164 ?? null,
          dob ?? null,
        ]
      );

      if (!rows[0]) {
        return reply
          .code(404)
          .send({ error: "NOT_FOUND", message: "User not found." });
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
  });

  /**
   * ----------------------------------------------------
   * PATCH /users/email/sync
   * ----------------------------------------------------
   * Sync email + email_verified from Firebase token -> DB
   * Client sends nothing except Authorization header
   */
  app.patch(
    "/users/email/sync",
    { preHandler: requireAuth },
    async (req, reply) => {
      const u = req.user as any;

      const tokenEmail = u.email ?? null;
      const tokenEmailVerified =
        u.email_verified ?? u.emailVerified ?? u.emailVerified === true;

      if (!tokenEmail) {
        return reply.code(400).send({
          error: "NO_FIREBASE_EMAIL",
          message: "Firebase user has no email.",
        });
      }

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
        [u.uid, String(tokenEmail).toLowerCase(), tokenEmailVerified === true]
      );

      if (!rows[0]) return reply.code(404).send({ error: "User not found" });
      return reply.send({ user: rows[0] });
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
    { preHandler: requireAuth },
    async (req, reply) => {
      const u = req.user as any;

      const phone =
        u.phone_number ?? u.phoneNumber ?? u.phone ?? u.phone_e164 ?? null;

      if (!phone) {
        return reply.code(400).send({
          error: "NO_FIREBASE_PHONE",
          message: "Firebase user has no verified phone number",
        });
      }

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
        [u.uid, String(phone)]
      );

      if (!rows[0]) return reply.code(404).send({ error: "User not found" });
      return reply.send({ user: rows[0] });
    }
  );
};

export default userRoutes;

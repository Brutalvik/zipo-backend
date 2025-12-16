// src/plugins/auth.ts
import "dotenv/config";
import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import oauth2, { type OAuth2Namespace } from "@fastify/oauth2";
import jwt from "@fastify/jwt";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import admin from "firebase-admin";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type AuthUser = {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  phoneNumber?: string;
  name?: string;
  picture?: string;
  claims: Record<string, unknown>;
  // keep the raw decoded token accessible if needed later:
  raw?: Record<string, unknown>;
};

/* ------------------------------------------------------------------ */
/* Type augmentation                                                   */
/* ------------------------------------------------------------------ */

declare module "fastify" {
  interface FastifyInstance {
    googleOAuth2: OAuth2Namespace;
    requireUiAuth: any;

    // ✅ Firebase Admin + API guard
    firebaseAdmin: typeof admin;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    // ✅ Firebase-authenticated user (preferred)
    authUser?: AuthUser;
  }
}

declare module "@fastify/session" {
  interface FastifySessionObject {
    user?: {
      id: string;
      email: string;
      name: string;
      picture?: string;
    };
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function initFirebaseAdmin(): typeof admin {
  if (admin.apps.length) return admin;

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (rawJson) {
    const json = JSON.parse(rawJson);
    admin.initializeApp({
      credential: admin.credential.cert(json),
    });
    return admin;
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  return admin;
}

function parseBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;

  return match[1].trim();
}

function asBool(v: unknown): boolean | undefined {
  if (v === true) return true;
  if (v === false) return false;
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Plugin                                                             */
/* ------------------------------------------------------------------ */

const authPlugin: FastifyPluginAsync = async (app) => {
  /* -------------------- Cookies -------------------- */
  await app.register(cookie);

  /* -------------------- Sessions (UI only) -------------------- */
  await app.register(session, {
    secret: mustGetEnv("SESSION_SECRET"),
    cookieName: "zipo.sid",
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    saveUninitialized: false,
  });

  /* -------------------- JWT (issued but NOT enforced) -------------------- */
  await app.register(jwt, {
    secret: mustGetEnv("JWT_SECRET"),
    sign: {
      expiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
    },
  });

  /* -------------------- Firebase Admin (API auth) -------------------- */
  const fbAdmin = initFirebaseAdmin();
  app.decorate("firebaseAdmin", fbAdmin);

  /**
   * ✅ API guard for mobile/API:
   * - Verifies Firebase ID token from Authorization: Bearer <token>
   * - Attaches req.authUser
   * - For legacy compatibility, also sets (req as any).user = decoded (runtime only)
   */
  app.decorate(
    "authenticate",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const token = parseBearerToken(req);
      if (!token) {
        reply.code(401).send({
          error: "Unauthorized",
          message: "Missing Authorization Bearer token",
        });
        return;
      }

      try {
        const decoded = await app.firebaseAdmin.auth().verifyIdToken(token);

        const raw = decoded as unknown as Record<string, unknown>;

        req.authUser = {
          uid: String(decoded.uid),
          email: decoded.email ?? undefined,
          emailVerified:
            asBool((raw as any).email_verified) ??
            asBool((raw as any).emailVerified) ??
            (decoded.email_verified === true ? true : undefined),
          phoneNumber:
            typeof (raw as any).phone_number === "string"
              ? (raw as any).phone_number
              : typeof (raw as any).phoneNumber === "string"
              ? (raw as any).phoneNumber
              : undefined,
          name:
            typeof (raw as any).name === "string"
              ? (raw as any).name
              : undefined,
          picture:
            typeof (raw as any).picture === "string"
              ? (raw as any).picture
              : undefined,
          claims: raw,
          raw,
        } as any;

        // ✅ Legacy compatibility for existing routes that read req.user
        // Do NOT type-augment req.user (avoids TS conflicts with fastify-jwt).
        (req as any).user = decoded;
        return;
      } catch (_err) {
        reply.code(401).send({
          error: "Unauthorized",
          message: "Invalid or expired token",
        });
        return;
      }
    }
  );

  /* -------------------- Google OAuth (Gateway UI) -------------------- */
  await app.register(oauth2, {
    name: "googleOAuth2",
    credentials: {
      client: {
        id: mustGetEnv("GOOGLE_CLIENT_ID"),
        secret: mustGetEnv("GOOGLE_CLIENT_SECRET"),
      },
      auth: {
        authorizeHost: "https://accounts.google.com",
        authorizePath: "/o/oauth2/v2/auth",
        tokenHost: "https://oauth2.googleapis.com",
        tokenPath: "/token",
      },
    },
    startRedirectPath: "/auth/google",
    callbackUri: mustGetEnv("GOOGLE_CALLBACK_URL"),
    scope: ["openid", "email", "profile"],
  });

  /* -------------------- OAuth Callback -------------------- */
  app.get("/auth/google/callback", async (req, reply) => {
    const token =
      await app.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);

    const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${token.token.access_token}`,
      },
    });

    if (!r.ok) {
      const errorText = await r.text();
      app.log.error({ errorText }, "Failed to fetch Google userinfo");
      return reply.code(401).send({ error: "Google auth failed" });
    }

    const profile: any = await r.json();

    req.session.user = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
    };

    return reply.redirect("/");
  });

  /* -------------------- JWT token (for inspection / future mobile) -------------------- */
  app.get("/auth/token", async (req, reply) => {
    const user = req.session.user;

    if (!user) {
      return reply.code(401).send({ error: "Not authenticated" });
    }

    const accessToken = app.jwt.sign({
      sub: user.id,
      email: user.email,
      name: user.name,
    });

    return { accessToken };
  });

  /* -------------------- Logout -------------------- */
  app.get("/logout", async (req, reply) => {
    await req.session.destroy();
    return reply.redirect("/");
  });

  /* -------------------- UI Guard (Gateway only) -------------------- */
  app.decorate("requireUiAuth", async (req: any, reply: any) => {
    if (!req.session?.user) {
      return reply.redirect("/login");
    }
  });
};

export default fp(authPlugin);

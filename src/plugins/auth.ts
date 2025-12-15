// src/plugins/auth.ts
import "dotenv/config";
import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import oauth2, { type OAuth2Namespace } from "@fastify/oauth2";
import jwt from "@fastify/jwt";
import type { FastifyPluginAsync } from "fastify";

/* ------------------------------------------------------------------ */
/* Type augmentation                                                   */
/* ------------------------------------------------------------------ */

declare module "fastify" {
  interface FastifyInstance {
    googleOAuth2: OAuth2Namespace;
    requireUiAuth: any;
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

  /* -------------------- Google OAuth -------------------- */

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

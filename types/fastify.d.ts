import "fastify";
import admin from "firebase-admin";

type AuthUser = {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  phoneNumber?: string;
  name?: string;
  picture?: string;
  claims: Record<string, unknown>;
};

declare module "fastify" {
  interface FastifyInstance {
    firebaseAdmin: typeof admin;
    authenticate: (req: any, reply: any) => Promise<void>;
  }

  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

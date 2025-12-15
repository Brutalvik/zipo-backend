// index.ts (GCF Entry Point - ESM compliant)
import { type HttpFunction } from "@google-cloud/functions-framework";
import { buildApp } from "./src/app.js"; // 🚨 IMPORTANT: Use .js extension for ESM imports

// Build the Fastify app instance once globally.
// This is critical for improving cold start times and reusing the app instance across function calls.
const fastifyApp = buildApp();

/**
 * The Google Cloud Function entry point.
 * This function handles the raw HTTP request/response objects provided by GCF's runtime.
 * We pipe them into the Fastify server instance.
 */
export const fastifyServer: HttpFunction = async (req, res) => {
  await fastifyApp.ready();
  fastifyApp.server.emit("request", req, res);
};

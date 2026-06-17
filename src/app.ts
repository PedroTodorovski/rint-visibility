import Fastify from "fastify";

import type { AppConfig } from "./config.js";
import { registerHealthRoute } from "./routes/health.js";

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
    },
  });

  await registerHealthRoute(app, config);

  // v1 API routes (stores, probes, scores) will mount under /v1 with Bearer auth.
  app.get("/", async () => ({
    service: config.serviceName,
    docs: "Engine-only microservice — no UI. See README.md.",
  }));

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

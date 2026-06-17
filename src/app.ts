import Fastify from "fastify";

import { registerCrudRoutes, type BuildAppDeps } from "./app-deps.js";
import type { AppConfig } from "./config.js";
import { registerBearerAuth } from "./plugins/bearer-auth.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerV1StatusRoute } from "./routes/v1/status.js";

export async function buildApp(config: AppConfig, deps: BuildAppDeps = {}) {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
    },
  });

  await registerErrorHandler(app);
  await registerHealthRoute(app, config);

  app.get("/", async () => ({
    service: config.serviceName,
    docs: "Engine-only microservice — no UI. See README.md.",
  }));

  await app.register(
    async (v1) => {
      await registerBearerAuth(v1, config);
      await registerV1StatusRoute(v1, config);
      await registerCrudRoutes(v1, config, deps);
    },
    { prefix: "/v1" },
  );

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

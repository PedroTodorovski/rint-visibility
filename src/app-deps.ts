import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "./config.js";
import { hasSupabaseConfig } from "./config.js";
import { createRepositories, type VisibilityRepositories } from "./repositories/index.js";
import { registerProductRoutes } from "./routes/v1/products.js";
import { registerPromptRoutes } from "./routes/v1/prompts.js";
import { registerStoreRoutes } from "./routes/v1/stores.js";

export type BuildAppDeps = {
  repositories?: VisibilityRepositories;
};

function notConfiguredReply() {
  return {
    error: "Supabase credentials are not configured",
    code: "SUPABASE_NOT_CONFIGURED" as const,
  };
}

async function registerUnconfiguredCrudRoutes(app: FastifyInstance): Promise<void> {
  const respond = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send(notConfiguredReply());

  app.get("/stores", respond);
  app.put("/stores", respond);
  app.get("/products", respond);
  app.post("/products", respond);
  app.patch("/products/:productId", respond);
  app.delete("/products/:productId", respond);
  app.get("/prompts", respond);
  app.post("/prompts", respond);
  app.patch("/prompts/:promptId", respond);
  app.delete("/prompts/:promptId", respond);
}

export function resolveRepositories(
  config: AppConfig,
  deps: BuildAppDeps = {},
): VisibilityRepositories | undefined {
  if (deps.repositories) {
    return deps.repositories;
  }

  if (!hasSupabaseConfig(config)) {
    return undefined;
  }

  return createRepositories(config);
}

export async function registerCrudRoutes(
  app: FastifyInstance,
  config: AppConfig,
  deps: BuildAppDeps = {},
): Promise<void> {
  const repositories = resolveRepositories(config, deps);

  if (!repositories) {
    await registerUnconfiguredCrudRoutes(app);
    return;
  }

  await registerStoreRoutes(app, repositories);
  await registerProductRoutes(app, repositories);
  await registerPromptRoutes(app, repositories);
}

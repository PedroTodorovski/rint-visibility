import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "./config.js";
import { hasSupabaseConfig } from "./config.js";
import type { LlmClients } from "./lib/llm/types.js";
import { createRepositories, type VisibilityRepositories } from "./repositories/index.js";
import { registerDiagnosticsRoutes } from "./routes/v1/diagnostics.js";
import { registerProbeRunRoutes } from "./routes/v1/probe-runs.js";
import { registerProbeRoutes } from "./routes/v1/probes.js";
import { registerProductRoutes } from "./routes/v1/products.js";
import { registerPromptRoutes } from "./routes/v1/prompts.js";
import { registerResultRoutes } from "./routes/v1/results.js";
import { registerScoreRoutes } from "./routes/v1/scores.js";
import { registerStoreRoutes } from "./routes/v1/stores.js";
import { createDiagnosticQueue, type DiagnosticQueue } from "./services/diagnostic-queue.js";
import type { PreviewGeminiProbeStore } from "./services/preview-gemini-probe.js";

export type BuildAppDeps = {
  repositories?: VisibilityRepositories;
  diagnosticQueue?: DiagnosticQueue;
  llm?: LlmClients;
  previewProbeStore?: PreviewGeminiProbeStore;
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
  app.delete("/stores", respond);
  app.get("/products", respond);
  app.post("/products", respond);
  app.patch("/products/:productId", respond);
  app.delete("/products/:productId", respond);
  app.get("/prompts", respond);
  app.post("/prompts", respond);
  app.patch("/prompts/:promptId", respond);
  app.delete("/prompts/:promptId", respond);
  app.post("/probes/run", respond);
  app.get("/scores/latest", respond);
  app.get("/results", respond);
  app.get("/probe-runs", respond);
  app.get("/probe-runs/compare", respond);
  app.get("/probe-runs/:runId/results", respond);
  app.post("/diagnostics/run", respond);
  app.get("/jobs", respond);
  app.get("/jobs/:jobId", respond);
  app.get("/diagnostics/:jobId", respond);
  app.get("/diagnostics/latest", respond);
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
  await registerProbeRoutes(app, repositories, config);
  await registerProbeRunRoutes(app, repositories);
  const diagnosticQueue =
    deps.diagnosticQueue ?? createDiagnosticQueue({ repos: repositories, config });
  await registerDiagnosticsRoutes(app, repositories, config, diagnosticQueue);
  await registerScoreRoutes(app, repositories);
  await registerResultRoutes(app, repositories);
}

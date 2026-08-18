import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../../config.js";
import { notFound } from "../../lib/errors.js";
import type { LlmClients } from "../../lib/llm/types.js";
import { requireWorkspaceId } from "../../lib/request.js";
import {
  executePreviewProbeRun,
  PreviewGeminiProbeStore,
  parsePreviewProbeBody,
  resolvePreviewLlm,
} from "../../services/preview-gemini-probe.js";

export type PreviewProbeRouteDeps = {
  llm?: LlmClients;
  previewProbeStore?: PreviewGeminiProbeStore;
};

const stores = new WeakMap<FastifyInstance, PreviewGeminiProbeStore>();

function storeFor(app: FastifyInstance, deps: PreviewProbeRouteDeps): PreviewGeminiProbeStore {
  if (deps.previewProbeStore) return deps.previewProbeStore;
  const existing = stores.get(app);
  if (existing) return existing;
  const created = new PreviewGeminiProbeStore();
  stores.set(app, created);
  return created;
}

export async function registerPreviewProbeRoutes(
  app: FastifyInstance,
  config: AppConfig,
  deps: PreviewProbeRouteDeps = {},
): Promise<void> {
  const store = storeFor(app, deps);

  app.post("/preview/gemini-probe", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const llm = resolvePreviewLlm(config, deps.llm);
    if (!llm) {
      return reply.code(503).send({
        error: "Gemini is not configured",
        code: "GEMINI_NOT_CONFIGURED",
      });
    }

    const body = parsePreviewProbeBody(request.body);
    const run = store.create({
      workspaceId,
      store: body.store,
      queries: body.queries,
    });

    void executePreviewProbeRun({
      store,
      runId: run.id,
      identity: body.store,
      queries: body.queries,
      llm,
      concurrency: config.diagnosticQueryConcurrency,
    });

    return reply.code(202).send(run);
  });

  app.get("/preview/gemini-probe/:runId", async (request) => {
    const workspaceId = requireWorkspaceId(request);
    const params = request.params as { runId?: string };
    const run = store.get(params.runId ?? "");
    if (!run || run.workspace_id !== workspaceId) {
      throw notFound("Preview Gemini probe not found");
    }
    return run;
  });
}

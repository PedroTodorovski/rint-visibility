import type { FastifyInstance } from "fastify";

import { requireWorkspaceId } from "../../lib/request.js";
import type { VisibilityRepositories } from "../../repositories/index.js";
import { runProbeForWorkspace } from "../../services/probe-runner.js";
import type { AppConfig } from "../../config.js";
import { createLlmClients } from "../../lib/llm/index.js";

export async function registerProbeRoutes(
  app: FastifyInstance,
  repos: VisibilityRepositories,
  config: AppConfig,
): Promise<void> {
  app.post("/probes/run", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const llm = createLlmClients(config);
    const outcome = await runProbeForWorkspace(repos, llm, workspaceId);

    return reply.code(200).send({
      probe_run_id: outcome.probeRunId,
      weekly_score_id: outcome.weeklyScoreId,
      citations_count: outcome.citationsCount,
      citation_slots_total: outcome.citationSlotsTotal,
    });
  });
}

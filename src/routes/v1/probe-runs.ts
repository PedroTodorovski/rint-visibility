import type { FastifyInstance } from "fastify";

import { notFound } from "../../lib/errors.js";
import { requireWorkspaceId } from "../../lib/request.js";
import type { VisibilityRepositories } from "../../repositories/index.js";
import { compareProbeResults } from "../../services/probe-compare.js";

function parsePagination(query: { page?: string; limit?: string }) {
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit ?? "20", 10) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export async function registerProbeRunRoutes(
  app: FastifyInstance,
  repos: VisibilityRepositories,
): Promise<void> {
  app.get("/probe-runs", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.findByWorkspaceId(workspaceId);

    if (!store) {
      return reply.code(404).send({
        error: `Store not found for workspace ${workspaceId}`,
        code: "NOT_FOUND",
      });
    }

    const query = request.query as { page?: string; limit?: string };
    const { page, limit, offset } = parsePagination(query);
    const runs = await repos.probeRuns.listByStoreId(store.id, { limit, offset });
    const counts = await repos.results.countByProbeRunIds(runs.map((r) => r.id));

    const probeRuns = runs.map((run) => {
      const count = counts.get(run.id) ?? { cited: 0, total: 0 };
      return {
        ...run,
        citations_count: count.cited,
        citation_slots_total: count.total,
      };
    });

    return reply.code(200).send({ probe_runs: probeRuns, page, limit });
  });

  app.get("/probe-runs/compare", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.findByWorkspaceId(workspaceId);

    if (!store) {
      return reply.code(404).send({
        error: `Store not found for workspace ${workspaceId}`,
        code: "NOT_FOUND",
      });
    }

    const query = request.query as { from?: string; to?: string };
    const fromRunId = query.from?.trim();
    const toRunId = query.to?.trim();

    if (!fromRunId || !toRunId) {
      return reply.code(400).send({
        error: "Query params from and to are required",
        code: "BAD_REQUEST",
      });
    }

    const [fromRun, toRun] = await Promise.all([
      repos.probeRuns.findByIdForStore(store.id, fromRunId),
      repos.probeRuns.findByIdForStore(store.id, toRunId),
    ]);

    if (!fromRun || !toRun) {
      return reply.code(404).send({
        error: "One or both probe runs were not found",
        code: "NOT_FOUND",
      });
    }

    const [fromResults, toResults] = await Promise.all([
      repos.results.listByProbeRunId(store.id, fromRunId),
      repos.results.listByProbeRunId(store.id, toRunId),
    ]);

    const comparison = compareProbeResults(fromRunId, toRunId, fromResults, toResults);
    return reply.code(200).send({ comparison });
  });

  app.get("/probe-runs/:runId/results", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.findByWorkspaceId(workspaceId);

    if (!store) {
      return reply.code(404).send({
        error: `Store not found for workspace ${workspaceId}`,
        code: "NOT_FOUND",
      });
    }

    const { runId } = request.params as { runId: string };
    const run = await repos.probeRuns.findByIdForStore(store.id, runId);

    if (!run) {
      throw notFound(`Probe run ${runId} not found`);
    }

    const results = await repos.results.listByProbeRunId(store.id, runId);
    const counts = await repos.results.countByProbeRunIds([runId]);
    const count = counts.get(runId) ?? { cited: 0, total: 0 };

    return reply.code(200).send({
      probe_run: {
        ...run,
        citations_count: count.cited,
        citation_slots_total: count.total,
      },
      results,
    });
  });
}

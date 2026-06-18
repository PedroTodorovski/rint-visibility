import type { FastifyInstance } from "fastify";

import { requireWorkspaceId } from "../../lib/request.js";
import type { VisibilityRepositories } from "../../repositories/index.js";

function parsePagination(query: { page?: string; limit?: string }) {
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit ?? "50", 10) || 50));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export async function registerResultRoutes(
  app: FastifyInstance,
  repos: VisibilityRepositories,
): Promise<void> {
  app.get("/results", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.findByWorkspaceId(workspaceId);

    if (!store) {
      return reply.code(404).send({
        error: `Store not found for workspace ${workspaceId}`,
        code: "NOT_FOUND",
      });
    }

    const query = request.query as { page?: string; limit?: string; probe_run_id?: string };
    const { page, limit, offset } = parsePagination(query);
    const results = await repos.results.listByStoreId(store.id, {
      limit,
      offset,
      probeRunId: query.probe_run_id?.trim() || undefined,
    });

    return reply.code(200).send({ results, page, limit });
  });
}

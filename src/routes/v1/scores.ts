import type { FastifyInstance } from "fastify";

import { requireWorkspaceId } from "../../lib/request.js";
import type { VisibilityRepositories } from "../../repositories/index.js";

export async function registerScoreRoutes(
  app: FastifyInstance,
  repos: VisibilityRepositories,
): Promise<void> {
  app.get("/scores/latest", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.findByWorkspaceId(workspaceId);

    if (!store) {
      return reply.code(404).send({
        error: `Store not found for workspace ${workspaceId}`,
        code: "NOT_FOUND",
      });
    }

    const score = await repos.weeklyScores.findLatestByStoreId(store.id);

    if (!score) {
      return reply.code(404).send({
        error: "No weekly score yet",
        code: "NOT_FOUND",
      });
    }

    return reply.code(200).send({ score });
  });
}

import type { FastifyInstance } from "fastify";

import {
  optionalString,
  requireNonEmptyString,
  requireWorkspaceId,
} from "../../lib/request.js";
import { validationError } from "../../lib/errors.js";
import type { VisibilityRepositories } from "../../repositories/index.js";
import type { StoreStatus, UpsertStoreInput } from "../../repositories/types.js";

function parseUpsertStoreBody(body: unknown): UpsertStoreInput {
  if (!body || typeof body !== "object") {
    throw validationError("Invalid request body");
  }

  const record = body as Record<string, unknown>;
  const input: UpsertStoreInput = {
    name: requireNonEmptyString(record.name, "name"),
    domain: optionalString(record.domain),
    locale: optionalString(record.locale) ?? undefined,
  };

  if (record.status !== undefined) {
    if (record.status !== "active" && record.status !== "paused") {
      throw validationError("status must be active or paused");
    }
    input.status = record.status as StoreStatus;
  }

  return input;
}

export async function registerStoreRoutes(
  app: FastifyInstance,
  repos: VisibilityRepositories,
): Promise<void> {
  app.get("/stores", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.findByWorkspaceId(workspaceId);

    if (!store) {
      return reply.code(404).send({
        error: `Store not found for workspace ${workspaceId}`,
        code: "NOT_FOUND",
      });
    }

    return reply.code(200).send({ store });
  });

  app.put("/stores", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const input = parseUpsertStoreBody(request.body);
    const store = await repos.stores.upsert(workspaceId, input);

    return reply.code(200).send({ store });
  });

  app.delete("/stores", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    await repos.stores.deleteByWorkspaceId(workspaceId);

    return reply.code(204).send();
  });
}

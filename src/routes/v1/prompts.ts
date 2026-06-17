import type { FastifyInstance } from "fastify";

import {
  optionalBoolean,
  optionalInteger,
  requireNonEmptyString,
  requireWorkspaceId,
} from "../../lib/request.js";
import { validationError } from "../../lib/errors.js";
import type { VisibilityRepositories } from "../../repositories/index.js";
import type { CreatePromptInput, UpdatePromptInput } from "../../repositories/types.js";

function parseCreatePromptBody(body: unknown): CreatePromptInput {
  if (!body || typeof body !== "object") {
    throw validationError("Invalid request body");
  }

  const record = body as Record<string, unknown>;

  return {
    prompt_text: requireNonEmptyString(record.prompt_text, "prompt_text"),
    active: optionalBoolean(record.active),
    sort_order: optionalInteger(record.sort_order, "sort_order"),
  };
}

function parseUpdatePromptBody(body: unknown): UpdatePromptInput {
  if (!body || typeof body !== "object") {
    throw validationError("Invalid request body");
  }

  const record = body as Record<string, unknown>;
  const input: UpdatePromptInput = {};

  if (record.prompt_text !== undefined) {
    input.prompt_text = requireNonEmptyString(record.prompt_text, "prompt_text");
  }
  if (record.active !== undefined) {
    input.active = optionalBoolean(record.active);
  }
  if (record.sort_order !== undefined) {
    input.sort_order = optionalInteger(record.sort_order, "sort_order");
  }

  if (Object.keys(input).length === 0) {
    throw validationError("At least one field is required");
  }

  return input;
}

export async function registerPromptRoutes(
  app: FastifyInstance,
  repos: VisibilityRepositories,
): Promise<void> {
  app.get("/prompts", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const prompts = await repos.prompts.listByStoreId(store.id);

    return reply.code(200).send({ prompts });
  });

  app.post("/prompts", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const input = parseCreatePromptBody(request.body);
    const prompt = await repos.prompts.create(store.id, input);

    return reply.code(201).send({ prompt });
  });

  app.patch("/prompts/:promptId", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const { promptId } = request.params as { promptId: string };
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const input = parseUpdatePromptBody(request.body);
    const prompt = await repos.prompts.update(store.id, promptId, input);

    return reply.code(200).send({ prompt });
  });

  app.delete("/prompts/:promptId", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const { promptId } = request.params as { promptId: string };
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    await repos.prompts.delete(store.id, promptId);

    return reply.code(204).send();
  });
}

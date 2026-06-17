import type { FastifyInstance } from "fastify";

import {
  optionalString,
  requireIntegerInRange,
  requireNonEmptyString,
  requireWorkspaceId,
} from "../../lib/request.js";
import { validationError } from "../../lib/errors.js";
import type { VisibilityRepositories } from "../../repositories/index.js";
import type { CreateProductInput, UpdateProductInput } from "../../repositories/types.js";

function parseCreateProductBody(body: unknown): CreateProductInput {
  if (!body || typeof body !== "object") {
    throw validationError("Invalid request body");
  }

  const record = body as Record<string, unknown>;

  return {
    url: requireNonEmptyString(record.url, "url"),
    title: optionalString(record.title),
    description: optionalString(record.description),
    position: requireIntegerInRange(record.position, "position", 1, 3),
  };
}

function parseUpdateProductBody(body: unknown): UpdateProductInput {
  if (!body || typeof body !== "object") {
    throw validationError("Invalid request body");
  }

  const record = body as Record<string, unknown>;
  const input: UpdateProductInput = {};

  if (record.url !== undefined) {
    input.url = requireNonEmptyString(record.url, "url");
  }
  if (record.title !== undefined) {
    input.title = optionalString(record.title);
  }
  if (record.description !== undefined) {
    input.description = optionalString(record.description);
  }
  if (record.position !== undefined) {
    input.position = requireIntegerInRange(record.position, "position", 1, 3);
  }

  if (Object.keys(input).length === 0) {
    throw validationError("At least one field is required");
  }

  return input;
}

export async function registerProductRoutes(
  app: FastifyInstance,
  repos: VisibilityRepositories,
): Promise<void> {
  app.get("/products", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const products = await repos.products.listByStoreId(store.id);

    return reply.code(200).send({ products });
  });

  app.post("/products", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const input = parseCreateProductBody(request.body);
    const product = await repos.products.create(store.id, input);

    return reply.code(201).send({ product });
  });

  app.patch("/products/:productId", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const { productId } = request.params as { productId: string };
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const input = parseUpdateProductBody(request.body);
    const product = await repos.products.update(store.id, productId, input);

    return reply.code(200).send({ product });
  });

  app.delete("/products/:productId", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const { productId } = request.params as { productId: string };
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    await repos.products.delete(store.id, productId);

    return reply.code(204).send();
  });
}

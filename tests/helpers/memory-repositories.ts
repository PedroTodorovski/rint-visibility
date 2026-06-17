import { randomUUID } from "node:crypto";

import type { VisibilityRepositories } from "../../src/repositories/index.js";
import type {
  CreateProductInput,
  CreatePromptInput,
  ProductRow,
  PromptRow,
  StoreRow,
  UpdateProductInput,
  UpdatePromptInput,
  UpsertStoreInput,
} from "../../src/repositories/types.js";
import { MAX_PRODUCTS_PER_STORE, MAX_PROMPTS_PER_STORE } from "../../src/repositories/types.js";
import { limitExceeded, notFound } from "../../src/lib/errors.js";

export function createMemoryRepositories(): VisibilityRepositories {
  const storesByWorkspace = new Map<string, StoreRow>();
  const productsByStore = new Map<string, ProductRow[]>();
  const promptsByStore = new Map<string, PromptRow[]>();

  return {
    stores: {
      async findByWorkspaceId(workspaceId: string) {
        return storesByWorkspace.get(workspaceId) ?? null;
      },
      async requireByWorkspaceId(workspaceId: string) {
        const store = storesByWorkspace.get(workspaceId);
        if (!store) {
          throw notFound(`Store not found for workspace ${workspaceId}`);
        }
        return store;
      },
      async upsert(workspaceId: string, input: UpsertStoreInput) {
        const existing = storesByWorkspace.get(workspaceId);
        const now = new Date().toISOString();
        const store: StoreRow = {
          id: existing?.id ?? randomUUID(),
          workspace_id: workspaceId,
          name: input.name,
          domain: input.domain ?? null,
          locale: input.locale ?? "en",
          status: input.status ?? "active",
          created_at: existing?.created_at ?? now,
          updated_at: now,
        };
        storesByWorkspace.set(workspaceId, store);
        return store;
      },
    },
    products: {
      async listByStoreId(storeId: string) {
        return [...(productsByStore.get(storeId) ?? [])].sort((a, b) => a.position - b.position);
      },
      async create(storeId: string, input: CreateProductInput) {
        const existing = productsByStore.get(storeId) ?? [];
        if (existing.length >= MAX_PRODUCTS_PER_STORE) {
          throw limitExceeded(`Store already has the maximum of ${MAX_PRODUCTS_PER_STORE} hero products`);
        }
        const now = new Date().toISOString();
        const product: ProductRow = {
          id: randomUUID(),
          store_id: storeId,
          url: input.url,
          title: input.title ?? null,
          description: input.description ?? null,
          position: input.position,
          created_at: now,
          updated_at: now,
        };
        productsByStore.set(storeId, [...existing, product]);
        return product;
      },
      async update(storeId: string, productId: string, input: UpdateProductInput) {
        const items = productsByStore.get(storeId) ?? [];
        const index = items.findIndex((item) => item.id === productId);
        if (index === -1) {
          throw notFound(`Product ${productId} not found`);
        }
        const updated: ProductRow = {
          ...items[index]!,
          ...input,
          updated_at: new Date().toISOString(),
        };
        items[index] = updated;
        productsByStore.set(storeId, items);
        return updated;
      },
      async delete(storeId: string, productId: string) {
        const items = productsByStore.get(storeId) ?? [];
        const next = items.filter((item) => item.id !== productId);
        if (next.length === items.length) {
          throw notFound(`Product ${productId} not found`);
        }
        productsByStore.set(storeId, next);
      },
    },
    prompts: {
      async listByStoreId(storeId: string) {
        return [...(promptsByStore.get(storeId) ?? [])].sort(
          (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
        );
      },
      async create(storeId: string, input: CreatePromptInput) {
        const existing = promptsByStore.get(storeId) ?? [];
        if (existing.length >= MAX_PROMPTS_PER_STORE) {
          throw limitExceeded(`Store already has the maximum of ${MAX_PROMPTS_PER_STORE} prompts`);
        }
        const now = new Date().toISOString();
        const prompt: PromptRow = {
          id: randomUUID(),
          store_id: storeId,
          prompt_text: input.prompt_text,
          active: input.active ?? true,
          sort_order: input.sort_order ?? 0,
          created_at: now,
          updated_at: now,
        };
        promptsByStore.set(storeId, [...existing, prompt]);
        return prompt;
      },
      async update(storeId: string, promptId: string, input: UpdatePromptInput) {
        const items = promptsByStore.get(storeId) ?? [];
        const index = items.findIndex((item) => item.id === promptId);
        if (index === -1) {
          throw notFound(`Prompt ${promptId} not found`);
        }
        const updated: PromptRow = {
          ...items[index]!,
          ...input,
          updated_at: new Date().toISOString(),
        };
        items[index] = updated;
        promptsByStore.set(storeId, items);
        return updated;
      },
      async delete(storeId: string, promptId: string) {
        const items = promptsByStore.get(storeId) ?? [];
        const next = items.filter((item) => item.id !== promptId);
        if (next.length === items.length) {
          throw notFound(`Prompt ${promptId} not found`);
        }
        promptsByStore.set(storeId, next);
      },
    },
  };
}

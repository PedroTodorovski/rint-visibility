import type { AppConfig } from "../config.js";
import { createSupabaseClient } from "../db/client.js";
import { ProductsRepository } from "./products.js";
import { PromptsRepository } from "./prompts.js";
import { StoresRepository } from "./stores.js";

import type {
  CreateProductInput,
  CreatePromptInput,
  ProductRow,
  PromptRow,
  StoreRow,
  UpdateProductInput,
  UpdatePromptInput,
  UpsertStoreInput,
} from "./types.js";

export type StoresRepositoryLike = {
  findByWorkspaceId(workspaceId: string): Promise<StoreRow | null>;
  requireByWorkspaceId(workspaceId: string): Promise<StoreRow>;
  upsert(workspaceId: string, input: UpsertStoreInput): Promise<StoreRow>;
};

export type ProductsRepositoryLike = {
  listByStoreId(storeId: string): Promise<ProductRow[]>;
  create(storeId: string, input: CreateProductInput): Promise<ProductRow>;
  update(storeId: string, productId: string, input: UpdateProductInput): Promise<ProductRow>;
  delete(storeId: string, productId: string): Promise<void>;
};

export type PromptsRepositoryLike = {
  listByStoreId(storeId: string): Promise<PromptRow[]>;
  create(storeId: string, input: CreatePromptInput): Promise<PromptRow>;
  update(storeId: string, promptId: string, input: UpdatePromptInput): Promise<PromptRow>;
  delete(storeId: string, promptId: string): Promise<void>;
};

export type VisibilityRepositories = {
  stores: StoresRepositoryLike;
  products: ProductsRepositoryLike;
  prompts: PromptsRepositoryLike;
};

export function createRepositories(config: AppConfig): VisibilityRepositories {
  const db = createSupabaseClient(config);
  return {
    stores: new StoresRepository(db),
    products: new ProductsRepository(db),
    prompts: new PromptsRepository(db),
  };
}

export { ProductsRepository } from "./products.js";
export { PromptsRepository } from "./prompts.js";
export { StoresRepository } from "./stores.js";
export * from "./types.js";

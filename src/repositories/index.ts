import type { AppConfig } from "../config.js";
import { createSupabaseClient } from "../db/client.js";
import { ProbeRunsRepository } from "./probe-runs.js";
import { ProductsRepository } from "./products.js";
import { PromptsRepository } from "./prompts.js";
import { ResultsRepository } from "./results.js";
import { StoresRepository } from "./stores.js";
import { WeeklyScoresRepository } from "./weekly-scores.js";

import type {
  CatalogFix,
  CreateProductInput,
  CreatePromptInput,
  ProductRow,
  ProbeRunRow,
  ProbeRunStatus,
  PromptRow,
  ResultRow,
  ResultWithPrompt,
  StoreRow,
  UpdateProductInput,
  UpdatePromptInput,
  UpsertStoreInput,
  WeeklyScoreRow,
} from "./types.js";
import type { CreateResultInput } from "./results.js";
import type { UpsertWeeklyScoreInput } from "./weekly-scores.js";

export type StoresRepositoryLike = {
  findByWorkspaceId(workspaceId: string): Promise<StoreRow | null>;
  requireByWorkspaceId(workspaceId: string): Promise<StoreRow>;
  upsert(workspaceId: string, input: UpsertStoreInput): Promise<StoreRow>;
  deleteByWorkspaceId(workspaceId: string): Promise<void>;
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

export type ProbeRunsRepositoryLike = {
  create(storeId: string, scheduledFor: string): Promise<ProbeRunRow>;
  updateStatus(
    id: string,
    status: ProbeRunStatus,
    fields?: { started_at?: string; completed_at?: string; error_message?: string },
  ): Promise<ProbeRunRow>;
  findLatestByStoreId(storeId: string): Promise<ProbeRunRow | null>;
  listByStoreId(
    storeId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ProbeRunRow[]>;
  findByIdForStore(storeId: string, runId: string): Promise<ProbeRunRow | null>;
};

export type ResultsRepositoryLike = {
  createMany(inputs: CreateResultInput[]): Promise<ResultRow[]>;
  listByStoreId(
    storeId: string,
    options?: { limit?: number; offset?: number; probeRunId?: string },
  ): Promise<ResultWithPrompt[]>;
  listByProbeRunId(storeId: string, probeRunId: string): Promise<ResultWithPrompt[]>;
  countByProbeRunIds(probeRunIds: string[]): Promise<Map<string, { cited: number; total: number }>>;
};

export type WeeklyScoresRepositoryLike = {
  upsert(input: UpsertWeeklyScoreInput): Promise<WeeklyScoreRow>;
  findLatestByStoreId(storeId: string): Promise<WeeklyScoreRow | null>;
};

export type VisibilityRepositories = {
  stores: StoresRepositoryLike;
  products: ProductsRepositoryLike;
  prompts: PromptsRepositoryLike;
  probeRuns: ProbeRunsRepositoryLike;
  results: ResultsRepositoryLike;
  weeklyScores: WeeklyScoresRepositoryLike;
};

export function createRepositories(config: AppConfig): VisibilityRepositories {
  const db = createSupabaseClient(config);
  return {
    stores: new StoresRepository(db),
    products: new ProductsRepository(db),
    prompts: new PromptsRepository(db),
    probeRuns: new ProbeRunsRepository(db),
    results: new ResultsRepository(db),
    weeklyScores: new WeeklyScoresRepository(db),
  };
}

export { ProductsRepository } from "./products.js";
export { PromptsRepository } from "./prompts.js";
export { ProbeRunsRepository } from "./probe-runs.js";
export { ResultsRepository } from "./results.js";
export { StoresRepository } from "./stores.js";
export { WeeklyScoresRepository } from "./weekly-scores.js";
export type { UpsertWeeklyScoreInput } from "./weekly-scores.js";
export type { CreateResultInput } from "./results.js";
export * from "./types.js";

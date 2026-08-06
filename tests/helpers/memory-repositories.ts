import { randomUUID } from "node:crypto";

import type { VisibilityRepositories } from "../../src/repositories/index.js";
import type { CreateResultInput } from "../../src/repositories/results.js";
import type { UpsertWeeklyScoreInput } from "../../src/repositories/weekly-scores.js";
import type {
  CreateProductInput,
  CreatePromptInput,
  ProbeRunRow,
  ProbeRunStatus,
  ProductRow,
  PromptRow,
  ResultRow,
  ResultWithPrompt,
  StoreRow,
  UpdateProductInput,
  UpdatePromptInput,
  UpsertStoreInput,
  WeeklyScoreRow,
} from "../../src/repositories/types.js";
import { MAX_PRODUCTS_PER_STORE, MAX_PROMPTS_PER_STORE } from "../../src/repositories/types.js";
import { limitExceeded, notFound } from "../../src/lib/errors.js";

export function createMemoryRepositories(): VisibilityRepositories {
  const storesByWorkspace = new Map<string, StoreRow>();
  const productsByStore = new Map<string, ProductRow[]>();
  const promptsByStore = new Map<string, PromptRow[]>();
  const probeRunsByStore = new Map<string, ProbeRunRow[]>();
  const resultsByProbeRun = new Map<string, ResultRow[]>();
  const weeklyScoresByStore = new Map<string, WeeklyScoreRow[]>();
  const portCacheStore = new Map<string, { payload: unknown; expires_at: string }>();
  const lacunaSnapshotRows: import("../../src/repositories/lacuna-snapshots.js").LacunaSnapshotRow[] = [];
  const dualTrackRows: import("../../src/repositories/dual-track-outputs.js").DualTrackOutputRow[] = [];

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
      async deleteByWorkspaceId(workspaceId: string) {
        const store = storesByWorkspace.get(workspaceId);
        if (!store) {
          throw notFound(`Store not found for workspace ${workspaceId}`);
        }
        storesByWorkspace.delete(workspaceId);
        productsByStore.delete(store.id);
        promptsByStore.delete(store.id);
        probeRunsByStore.delete(store.id);
        weeklyScoresByStore.delete(store.id);
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
          external_ref: input.external_ref ?? null,
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
          product_id: input.product_id ?? null,
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
    probeRuns: {
      async create(storeId: string, scheduledFor: string) {
        const now = new Date().toISOString();
        const run: ProbeRunRow = {
          id: randomUUID(),
          store_id: storeId,
          status: "pending",
          scheduled_for: scheduledFor,
          started_at: null,
          completed_at: null,
          error_message: null,
          created_at: now,
        };
        const list = probeRunsByStore.get(storeId) ?? [];
        probeRunsByStore.set(storeId, [...list, run]);
        return run;
      },
      async updateStatus(
        id: string,
        status: ProbeRunStatus,
        fields: { started_at?: string; completed_at?: string; error_message?: string } = {},
      ) {
        for (const [storeId, runs] of probeRunsByStore) {
          const index = runs.findIndex((r) => r.id === id);
          if (index !== -1) {
            const updated = { ...runs[index]!, status, ...fields };
            runs[index] = updated;
            probeRunsByStore.set(storeId, runs);
            return updated;
          }
        }
        throw notFound(`Probe run ${id} not found`);
      },
      async findLatestByStoreId(storeId: string) {
        const runs = probeRunsByStore.get(storeId) ?? [];
        return runs.length > 0 ? runs[runs.length - 1]! : null;
      },
      async listByStoreId(storeId: string, options: { limit?: number; offset?: number } = {}) {
        const limit = options.limit ?? 20;
        const offset = options.offset ?? 0;
        const runs = probeRunsByStore.get(storeId) ?? [];
        return [...runs].reverse().slice(offset, offset + limit);
      },
      async findByIdForStore(storeId: string, runId: string) {
        const runs = probeRunsByStore.get(storeId) ?? [];
        return runs.find((r) => r.id === runId) ?? null;
      },
    },
    results: {
      async createMany(inputs: CreateResultInput[]) {
        const created: ResultRow[] = [];
        for (const input of inputs) {
          const row: ResultRow = {
            id: randomUUID(),
            probe_run_id: input.probe_run_id,
            prompt_id: input.prompt_id,
            provider: input.provider,
            cited: input.cited,
            response_excerpt: input.response_excerpt,
            metadata: input.metadata,
            created_at: new Date().toISOString(),
          };
          const list = resultsByProbeRun.get(input.probe_run_id) ?? [];
          resultsByProbeRun.set(input.probe_run_id, [...list, row]);
          created.push(row);
        }
        return created;
      },
      async listByStoreId(
        storeId: string,
        options: { limit?: number; offset?: number; probeRunId?: string } = {},
      ) {
        const limit = options.limit ?? 50;
        const offset = options.offset ?? 0;
        const runs = probeRunsByStore.get(storeId) ?? [];
        const runCompleted = new Map(runs.map((r) => [r.id, r.completed_at]));
        const promptItems = promptsByStore.get(storeId) ?? [];
        const promptMap = new Map(promptItems.map((p) => [p.id, p.prompt_text]));

        const all: ResultWithPrompt[] = [];
        const filteredRuns = options.probeRunId
          ? runs.filter((r) => r.id === options.probeRunId)
          : [...runs].reverse();

        for (const run of filteredRuns) {
          for (const result of resultsByProbeRun.get(run.id) ?? []) {
            all.push({
              ...result,
              prompt_text: promptMap.get(result.prompt_id) ?? "",
              probe_completed_at: runCompleted.get(run.id) ?? null,
            });
          }
        }

        return all.slice(offset, offset + limit);
      },
      async listByProbeRunId(storeId: string, probeRunId: string) {
        const runs = probeRunsByStore.get(storeId) ?? [];
        const run = runs.find((r) => r.id === probeRunId);
        if (!run) return [];
        const promptItems = promptsByStore.get(storeId) ?? [];
        const promptMap = new Map(promptItems.map((p) => [p.id, p.prompt_text]));
        return (resultsByProbeRun.get(probeRunId) ?? []).map((result) => ({
          ...result,
          prompt_text: promptMap.get(result.prompt_id) ?? "",
          probe_completed_at: run.completed_at,
        }));
      },
      async countByProbeRunIds(probeRunIds: string[]) {
        const counts = new Map<string, { cited: number; total: number }>();
        for (const runId of probeRunIds) {
          const rows = resultsByProbeRun.get(runId) ?? [];
          counts.set(runId, {
            cited: rows.filter((r) => r.cited).length,
            total: rows.length,
          });
        }
        return counts;
      },
    },
    weeklyScores: {
      async upsert(input: UpsertWeeklyScoreInput) {
        const now = new Date().toISOString();
        const list = weeklyScoresByStore.get(input.store_id) ?? [];
        const index = list.findIndex((s) => s.week_start === input.week_start);
        const row: WeeklyScoreRow = {
          id: index >= 0 ? list[index]!.id : randomUUID(),
          store_id: input.store_id,
          probe_run_id: input.probe_run_id,
          week_start: input.week_start,
          prompts_total: input.prompts_total,
          citation_slots_total: input.citation_slots_total,
          citations_count: input.citations_count,
          score_pct: input.score_pct,
          fixes: input.fixes,
          created_at: index >= 0 ? list[index]!.created_at : now,
        };
        if (index >= 0) {
          list[index] = row;
        } else {
          list.push(row);
        }
        weeklyScoresByStore.set(input.store_id, list);
        return row;
      },
      async findLatestByStoreId(storeId: string) {
        const list = weeklyScoresByStore.get(storeId) ?? [];
        if (list.length === 0) return null;
        return [...list].sort((a, b) => b.week_start.localeCompare(a.week_start))[0]!;
      },
    },
    perRunReadCache: {
      async get(probeRunId: string, portName: string, cacheKey: string) {
        const key = `${probeRunId}:${portName}:${cacheKey}`;
        const row = portCacheStore.get(key);
        if (!row || row.expires_at <= new Date().toISOString()) return null;
        return {
          id: key,
          probe_run_id: probeRunId,
          port_name: portName,
          cache_key: cacheKey,
          payload: row.payload as Record<string, unknown>,
          fetched_at: new Date().toISOString(),
          expires_at: row.expires_at,
        };
      },
      async set(probeRunId: string, portName: string, cacheKey: string, payload: unknown, expiresAt: string) {
        const key = `${probeRunId}:${portName}:${cacheKey}`;
        portCacheStore.set(key, { payload, expires_at: expiresAt });
      },
    },
    lacunaSnapshots: {
      async create(input) {
        const row = {
          id: randomUUID(),
          ...input,
          created_at: new Date().toISOString(),
        };
        lacunaSnapshotRows.push(row);
        return row;
      },
      async findLatestByStoreId(storeId: string) {
        const matches = lacunaSnapshotRows.filter((r) => r.store_id === storeId);
        return matches.length > 0 ? matches[matches.length - 1]! : null;
      },
      async findByProbeRunId(probeRunId: string) {
        return lacunaSnapshotRows.find((r) => r.probe_run_id === probeRunId) ?? null;
      },
    },
    dualTrackOutputs: {
      async createMany(inputs) {
        const created = inputs.map((input) => ({
          id: randomUUID(),
          probe_run_id: input.probe_run_id,
          sku_ref_id: input.sku_ref_id,
          track_number: input.track_number,
          items: input.items,
          triage_owner: input.triage_owner,
          created_at: new Date().toISOString(),
        }));
        dualTrackRows.push(...created);
        return created;
      },
      async listByProbeRunId(probeRunId: string) {
        return dualTrackRows.filter((r) => r.probe_run_id === probeRunId);
      },
    },
  };
}

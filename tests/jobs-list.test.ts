import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emptyGeminiStructured } from "../src/lib/llm/gemini-structured.js";
import { authHeaders } from "../src/lib/request.js";
import type { ShopifyProductSnapshot } from "../src/services/diagnostic-types.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

const TEST_API_KEY = "test-visibility-api-key";
const WORKSPACE_ID = "ws_jobs_list";

function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "3010",
    VISIBILITY_API_KEY: TEST_API_KEY,
  });
}

function snapshot(name: string, url: string): ShopifyProductSnapshot {
  return {
    externalRef: null,
    url,
    name,
    brand: null,
    currentPrice: 0,
    currency: "BRL",
    attributes: [],
    variants: [],
    inventoryAvailable: null,
    image: null,
    meta: { source: "public_pdp", fetchedAt: "2026-08-16T17:00:00.000Z" },
  };
}

describe("GET /v1/jobs", () => {
  it("lists diagnostic job summaries with SKU names and query citation counts", async () => {
    const repositories = createMemoryRepositories();
    const app = await buildApp(testConfig(), { repositories });

    await app.inject({
      method: "PUT",
      url: `/v1/stores?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { name: "Acme Shop", domain: "acme.example" },
    });

    const store = await repositories.stores.requireByWorkspaceId(WORKSPACE_ID);
    const probeRun = await repositories.probeRuns.create(store.id, "2026-08-16");
    const job = await repositories.jobs.create({
      store_id: store.id,
      probe_run_id: probeRun.id,
      plan: "essential",
    });
    await repositories.jobs.updateStatus(job.id, "completed", {
      completed_at: "2026-08-16T17:48:00.000Z",
    });
    await repositories.diagnosticSkus.create({
      job_id: job.id,
      url: "https://acme.example/products/hero-sofa",
      shopify_data: snapshot("Hero Sofa", "https://acme.example/products/hero-sofa"),
    });
    await repositories.diagnosticQueries.create({
      job_id: job.id,
      sku_id: "sku-1",
      prompt_id: null,
      query_text: "melhor sofa",
      gemini_raw: null,
      gemini_structured: emptyGeminiStructured(),
      cliente_foi_citado: true,
      concorrente_citado_nome: null,
      concorrente_citado_url: null,
      atributos_mencionados_gemini: [],
      temperatura_gemini: 0,
      num_execucoes: 1,
      confianca: null,
      executions: [],
    });
    await repositories.diagnosticQueries.create({
      job_id: job.id,
      sku_id: "sku-1",
      prompt_id: null,
      query_text: "sofa modular",
      gemini_raw: null,
      gemini_structured: emptyGeminiStructured(),
      cliente_foi_citado: false,
      concorrente_citado_nome: "Rival",
      concorrente_citado_url: null,
      atributos_mencionados_gemini: [],
      temperatura_gemini: 0,
      num_execucoes: 1,
      confianca: null,
      executions: [],
    });
    await repositories.diagnostics.create({
      job_id: job.id,
      sku_id: null,
      track: "track_llm",
      causes: [],
      actions: [],
      next_steps: {},
      prazo: "esta_semana",
    });

    const emptyJob = await repositories.jobs.create({
      store_id: store.id,
      probe_run_id: null,
      plan: "essential",
    });

    const list = await app.inject({
      method: "GET",
      url: `/v1/jobs?workspace_id=${WORKSPACE_ID}&limit=30`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      jobs: Array<{
        id: string;
        sku_names: string[];
        cited: number;
        total: number;
        track: string | null;
        probe_run_id: string | null;
        providers: string[];
      }>;
      page: number;
      limit: number;
      total: number;
    };
    expect(body.page).toBe(1);
    expect(body.limit).toBe(30);
    expect(body.total).toBe(2);
    expect(body.jobs).toHaveLength(2);
    const completed = body.jobs.find((row) => row.id === job.id);
    const pending = body.jobs.find((row) => row.id === emptyJob.id);
    expect(completed).toMatchObject({
      id: job.id,
      probe_run_id: probeRun.id,
      sku_names: ["Hero Sofa"],
      cited: 1,
      total: 2,
      track: "track_llm",
      providers: [],
    });
    expect(pending).toMatchObject({
      id: emptyJob.id,
      sku_names: [],
      cited: 0,
      total: 0,
      track: null,
      providers: [],
    });
  });

  it("fails a running job that has been in-flight longer than 15 minutes", async () => {
    const repositories = createMemoryRepositories();
    const app = await buildApp(testConfig(), { repositories });

    await app.inject({
      method: "PUT",
      url: `/v1/stores?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { name: "Acme Shop", domain: "acme.example" },
    });

    const store = await repositories.stores.requireByWorkspaceId(WORKSPACE_ID);
    const job = await repositories.jobs.create({
      store_id: store.id,
      plan: "essential",
    });
    await repositories.jobs.updateStatus(job.id, "running", {
      started_at: "2026-08-19T11:29:20.000Z",
    });

    const list = await app.inject({
      method: "GET",
      url: `/v1/jobs?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(list.statusCode).toBe(200);
    const listed = list.json() as {
      jobs: Array<{ id: string; status: string; error_message: string | null }>;
    };
    expect(listed.jobs[0]).toMatchObject({
      id: job.id,
      status: "failed",
      error_message: "O diagnóstico parou antes de terminar. Tente de novo.",
    });

    const status = await app.inject({
      method: "GET",
      url: `/v1/jobs/${job.id}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      job: { id: job.id, status: "failed" },
    });
  });

  it("fails orphan in-flight jobs when the in-process API boots", async () => {
    const repositories = createMemoryRepositories();
    const store = await repositories.stores.upsert(WORKSPACE_ID, {
      name: "Acme Shop",
      domain: "acme.example",
    });
    const orphan = await repositories.jobs.create({
      store_id: store.id,
      plan: "essential",
    });
    await repositories.jobs.updateStatus(orphan.id, "running", {
      started_at: new Date().toISOString(),
    });

    await buildApp(testConfig(), { repositories });
    const afterBoot = await repositories.jobs.findById(orphan.id);
    expect(afterBoot?.status).toBe("failed");
    expect(afterBoot?.error_message).toBe("O diagnóstico parou antes de terminar. Tente de novo.");
  });
});

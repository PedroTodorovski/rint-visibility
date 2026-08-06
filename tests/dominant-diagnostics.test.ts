import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { authHeaders } from "../src/lib/request.js";
import { selectDominantSku } from "../src/services/dominant-diagnostic-runner.js";
import { computeTriage } from "../src/services/diagnostic-triage.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

const TEST_API_KEY = "test-visibility-api-key";
const WORKSPACE_ID = "ws_dominant_diagnostic";

function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "3010",
    VISIBILITY_API_KEY: TEST_API_KEY,
  });
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedStore(app: Awaited<ReturnType<typeof buildApp>>) {
  await app.inject({
    method: "PUT",
    url: `/v1/stores?workspace_id=${WORKSPACE_ID}`,
    headers: authHeaders(TEST_API_KEY),
    payload: { name: "Acme Shop", domain: "acme.example" },
  });

  const product = await app.inject({
    method: "POST",
    url: `/v1/products?workspace_id=${WORKSPACE_ID}`,
    headers: authHeaders(TEST_API_KEY),
    payload: {
      url: "https://acme.example/products/hero",
      title: "Hero Sofa",
      external_ref: "gid://shopify/Product/1",
      position: 1,
    },
  });

  await app.inject({
    method: "POST",
    url: `/v1/prompts?workspace_id=${WORKSPACE_ID}`,
    headers: authHeaders(TEST_API_KEY),
    payload: {
      prompt_text: "melhor sofá modular para apartamento",
      product_id: product.json().product.id,
      sort_order: 1,
    },
  });
}

async function waitForStatus(
  app: Awaited<ReturnType<typeof buildApp>>,
  jobId: string,
  status: string,
) {
  for (let i = 0; i < 30; i++) {
    const response = await app.inject({
      method: "GET",
      url: `/v1/jobs/${jobId}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    if (response.json().job.status === status) return response.json().job;
    await sleep(10);
  }
  throw new Error(`job did not reach ${status}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dominant diagnostics API", () => {
  it("enqueues, completes, and returns dominant diagnostic payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));

    const app = await buildApp(testConfig(), { repositories: createMemoryRepositories() });
    await seedStore(app);

    const run = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: {
        plan: "pro",
        integration_config: { shopify: { shopDomain: "acme.myshopify.com" } },
      },
    });

    expect(run.statusCode).toBe(202);
    expect(run.json().job_id).toBeTruthy();

    const job = await waitForStatus(app, run.json().job_id, "completed");
    expect(job.plan).toBe("pro");

    const diagnostic = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/${run.json().job_id}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(diagnostic.statusCode).toBe(200);
    expect(diagnostic.json().diagnostic.track).toMatch(/^track_/);
    expect(diagnostic.json().triage_result.track_assigned).toBe(diagnostic.json().diagnostic.track);
    expect(diagnostic.json().queries[0].num_execucoes).toBe(3);
    expect(diagnostic.json().queries[0].confianca).toContain("3 de 3");
    expect(diagnostic.json().financial_risk.map((row: { formula_type: string }) => row.formula_type)).toContain(
      "lacuna_ai_floor",
    );
    expect(diagnostic.json().financial_risk.map((row: { formula_type: string }) => row.formula_type)).toContain(
      "compensation_cost_media",
    );
  });

  it("hard-stops job when Shopify is not connected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));

    const app = await buildApp(testConfig(), { repositories: createMemoryRepositories() });
    await seedStore(app);

    const run = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { plan: "essential" },
    });

    expect(run.statusCode).toBe(202);
    const job = await waitForStatus(app, run.json().job_id, "failed");
    expect(job.error_message).toMatch(/Shopify precisa estar conectado/);
  });
});

describe("dominant SKU selection", () => {
  it("selects the SKU with the highest visibility gap score within the cluster", () => {
    const skus = [
      {
        row: {
          id: "sku-cited",
          product_id: "product-cited",
          external_ref: "gid://shopify/Product/1",
          validation_status: "valid",
        },
        product: { id: "product-cited", external_ref: "gid://shopify/Product/1" },
        prompts: [],
      },
      {
        row: {
          id: "sku-leaking",
          product_id: "product-leaking",
          external_ref: "gid://shopify/Product/2",
          validation_status: "valid",
        },
        product: { id: "product-leaking", external_ref: "gid://shopify/Product/2" },
        prompts: [],
      },
    ] as any;

    const queries = [
      {
        sku_id: "sku-cited",
        cliente_foi_citado: true,
        concorrente_citado_nome: null,
        concorrente_citado_url: null,
      },
      {
        sku_id: "sku-leaking",
        cliente_foi_citado: false,
        concorrente_citado_nome: "Competitor",
        concorrente_citado_url: "https://competitor.example/p",
      },
    ] as any;

    const result = selectDominantSku(skus, queries);

    expect(result.primary.row.id).toBe("sku-leaking");
    expect(result.selection).toMatchObject({
      strategy: "highest_visibility_gap_score",
      scope: "dominant_sku_within_cluster",
      selected_sku_id: "sku-leaking",
    });
  });
});

describe("dominant triage", () => {
  it("routes incoherent Gemini output to exactly track_llm", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            externalRef: "gid://shopify/Product/1",
            url: "https://acme.example/products/hero",
            name: "Hero Sofa",
            brand: "Acme",
            currentPrice: 500,
            currency: "BRL",
            attributes: ["Material: Boucle"],
            variants: [],
            inventoryAvailable: 10,
            meta: { source: "test", fetchedAt: new Date().toISOString() },
          },
        },
      ],
      queries: [
        {
          id: "q1",
          job_id: "job-1",
          sku_id: "sku-1",
          prompt_id: "p1",
          query_text: "query",
          gemini_raw: "raw",
          gemini_structured: {
            cliente_foi_citado: false,
            concorrente_citado_nome: "Other",
            concorrente_citado_url: "https://other.example/p",
            atributos_mencionados_gemini: [],
            preco_citado: 99,
            nome_marca_citada: "Outra Marca",
            produto_mencionado: "Outro Produto",
          },
          cliente_foi_citado: false,
          concorrente_citado_nome: "Other",
          concorrente_citado_url: "https://other.example/p",
          atributos_mencionados_gemini: [],
          temperatura_gemini: 0,
          num_execucoes: 1,
          confianca: null,
          executions: [],
          created_at: new Date().toISOString(),
        },
      ],
    });

    expect(outcome.coherenceLevel).toBe("incoerente");
    expect(outcome.track).toBe("track_llm");
    expect(outcome.checks.one_dominant_track).toBe(true);
  });
});

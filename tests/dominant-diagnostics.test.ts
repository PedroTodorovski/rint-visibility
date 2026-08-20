import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emptyGeminiStructured } from "../src/lib/llm/gemini-structured.js";
import { SHOPPER_EVIDENCE_MISSING } from "../src/lib/llm/shopper-evidence.js";
import { authHeaders } from "../src/lib/request.js";
import { computeTriage } from "../src/services/diagnostic-triage.js";
import type { GeminiStructuredOutput } from "../src/services/diagnostic-types.js";
import { selectDominantSku } from "../src/services/dominant-diagnostic-runner.js";
import { liveLlm, stubLlmClient } from "./helpers/live-llm.js";
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
  it("caches port reads by probe_run_id, never by job id", () => {
    const runner = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../src/services/dominant-diagnostic-runner.ts",
      ),
      "utf-8",
    );
    expect(runner).toContain("job.probe_run_id");
    expect(runner).toContain("cachePort");
    expect(runner).toMatch(/readThroughCache\(\s*deps\.repos\.perRunReadCache,\s*probeRunId/);
    expect(runner).toContain("completeCitedOffers");
    expect(runner).toContain("planCitedOfferFollowUp");
    expect(runner).toContain("follow_up: true");
  });
  it("enqueues, completes, and returns dominant diagnostic payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );

    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm(),
    });
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
    expect(diagnostic.json().queries[0].confianca).toContain("0 de 3");
    expect(diagnostic.json().queries[0].cliente_foi_citado).toBe(false);
    expect(diagnostic.json().queries[0].executions[0].citation.prompt).toBe("blind_shopper");
    expect(diagnostic.json().queries[0].executions[0].provider).toBe("gemini");
    expect(diagnostic.json().queries[0].executions[0].citation.cited).toBe(false);
    expect(
      diagnostic.json().financial_risk.map((row: { formula_type: string }) => row.formula_type),
    ).toContain("lacuna_ai_floor");
    expect(
      diagnostic.json().financial_risk.map((row: { formula_type: string }) => row.formula_type),
    ).toContain("compensation_cost_media");

    const byRun = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/latest?workspace_id=${WORKSPACE_ID}&probe_run_id=${job.probe_run_id}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(byRun.statusCode).toBe(200);
    expect(byRun.json().job.id).toBe(run.json().job_id);
    expect(byRun.json().queries.length).toBeGreaterThan(0);
  });

  it("completes on the public PDP floor when Shopify is not connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<html><head><script type="application/ld+json">{"@type":"Product","name":"Hero Sofa","offers":{"price":"4200","priceCurrency":"BRL"}}</script></head></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          ),
      ),
    );

    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm(),
    });
    await seedStore(app);

    const run = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { plan: "essential" },
    });

    expect(run.statusCode).toBe(202);
    const job = await waitForStatus(app, run.json().job_id, "completed");
    expect(job.status).toBe("completed");

    const diagnostic = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/${run.json().job_id}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(diagnostic.statusCode).toBe(200);
    expect(diagnostic.json().diagnostic).toBeNull();
    expect(diagnostic.json().triage_result).toBeNull();
    expect(diagnostic.json().queries.length).toBeGreaterThan(0);
    expect(diagnostic.json().skus[0].shopify_data.meta.source).toBe("public_pdp");
    expect(diagnostic.json().skus[0].shopify_data.name).toBe("Hero Sofa");
    expect(
      diagnostic.json().financial_risk.map((row: { formula_type: string }) => row.formula_type),
    ).toContain("lacuna_ai_floor");
  });

  it("fails the job when no enabled provider returns shopper text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm({
        gemini: stubLlmClient(async () => ({
          rawText: "",
          structured: emptyGeminiStructured(),
          model: "mock",
          mocked: true,
          usedWebSearch: false,
          groundingUrls: [],
          calls: [],
        })),
      }),
    });
    await seedStore(app);
    const run = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { plan: "essential" },
    });
    const job = await waitForStatus(app, run.json().job_id, "failed");
    expect(job.error_message).toBe(SHOPPER_EVIDENCE_MISSING);
  });

  it("calls an optional second diagnostic client in the same job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    const chatgptQueries: string[] = [];
    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm({
        chatgpt: stubLlmClient(async (input) => {
          chatgptQueries.push(input.query);
          return {
            rawText: `ChatGPT: ${input.query}`,
            structured: emptyGeminiStructured(),
            model: "gpt-test",
            mocked: false,
            usedWebSearch: true,
            groundingUrls: ["https://chat.openai.com"],
            calls: [],
          };
        }),
      }),
    });
    await seedStore(app);
    const run = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { plan: "essential" },
    });
    await waitForStatus(app, run.json().job_id, "completed");
    const diagnostic = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/${run.json().job_id}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    const providers = diagnostic
      .json()
      .queries[0].executions.map((row: { provider?: string }) => row.provider);
    expect(chatgptQueries.length).toBeGreaterThan(0);
    expect(providers).toContain("gemini");
    expect(providers).toContain("chatgpt");
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
  const shopify = {
    externalRef: "gid://shopify/Product/1",
    url: "https://acme.example/products/hero",
    name: "Hero Sofa",
    brand: "Acme",
    currentPrice: 500,
    currency: "BRL",
    attributes: ["Material: Boucle"],
    variants: [],
    inventoryAvailable: 10,
    image: null,
    meta: { source: "test", fetchedAt: new Date().toISOString() },
  };

  function query(structured: GeminiStructuredOutput, extra: Record<string, unknown> = {}) {
    return {
      id: "q1",
      job_id: "job-1",
      sku_id: "sku-1",
      prompt_id: "p1",
      query_text: "query",
      gemini_raw: "raw",
      gemini_structured: structured,
      cliente_foi_citado: false,
      concorrente_citado_nome: structured.concorrente_citado_nome ?? null,
      concorrente_citado_url: structured.concorrente_citado_url ?? null,
      atributos_mencionados_gemini: [],
      temperatura_gemini: 0,
      num_execucoes: 1,
      confianca: null,
      executions: [],
      created_at: new Date().toISOString(),
      ...extra,
    };
  }

  it("does not treat a cheaper occupant as incoherence — 0/N is Content", () => {
    const outcome = computeTriage({
      skus: [{ id: "sku-1", shopify }],
      queries: [
        query({
          cliente_foi_citado: false,
          concorrente_citado_nome: "Other",
          concorrente_citado_url: "https://other.example/p",
          atributos_mencionados_gemini: [],
          preco_citado: 99,
          nome_marca_citada: "Outra Marca",
          produto_mencionado: "Outro Produto",
          objetos_citados: [
            {
              marca: "Outra Marca",
              loja: "Other",
              produto: "Outro Produto",
              url: "https://other.example/p",
              preco: 99,
              moeda: "BRL",
              dimensoes: null,
              qualidade: null,
              prazo_entrega: null,
              avaliacao: null,
              imagem_url: null,
              atributos: [],
            },
          ],
        }),
      ],
    });

    expect(outcome.coherenceLevel).toBe("coerente");
    expect(outcome.track).toBe("track_llm");
    expect(outcome.checks.one_dominant_track).toBe(true);
  });

  it("routes a closed Shopify storefront to track_pdp even when Admin has the SKU", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            meta: {
              ...shopify.meta,
              source: "shopify_api",
              hasJsonLd: null,
              storefrontAccess: "password",
            },
          },
        },
      ],
      queries: [
        query({
          cliente_foi_citado: false,
          concorrente_citado_nome: "Other",
          concorrente_citado_url: "https://other.example/p",
          atributos_mencionados_gemini: [],
          preco_citado: 99,
          nome_marca_citada: "Outra Marca",
          produto_mencionado: "Outro Produto",
          objetos_citados: [],
        }),
      ],
    });

    expect(outcome.track).toBe("track_pdp");
    expect(outcome.checks.storefront_not_public).toBe(true);
  });

  it("routes a non-public URL to track_pdp on a public PDP snapshot, not only Shopify Admin", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            meta: {
              source: "public_pdp",
              fetchedAt: shopify.meta.fetchedAt,
              hasJsonLd: null,
              storefrontAccess: "password",
            },
          },
        },
      ],
      queries: [
        query({
          cliente_foi_citado: false,
          concorrente_citado_nome: "Other",
          concorrente_citado_url: "https://other.example/p",
          atributos_mencionados_gemini: [],
          preco_citado: 99,
          nome_marca_citada: "Outra Marca",
          produto_mencionado: "Outro Produto",
          objetos_citados: [],
        }),
      ],
    });

    expect(outcome.track).toBe("track_pdp");
    expect(outcome.checks.storefront_not_public).toBe(true);
  });

  it("routes a wrong price on the client object to track_llm", () => {
    const outcome = computeTriage({
      skus: [{ id: "sku-1", shopify }],
      queries: [
        query(
          {
            cliente_foi_citado: true,
            concorrente_citado_nome: null,
            concorrente_citado_url: null,
            atributos_mencionados_gemini: [],
            preco_citado: 99,
            nome_marca_citada: "Acme",
            produto_mencionado: "Hero Sofa",
            objetos_citados: [
              {
                marca: "Acme",
                loja: null,
                produto: "Hero Sofa",
                url: "https://acme.example/products/hero",
                preco: 99,
                moeda: "BRL",
                dimensoes: null,
                qualidade: null,
                prazo_entrega: null,
                avaliacao: null,
                imagem_url: null,
                atributos: [],
              },
            ],
          },
          { cliente_foi_citado: true },
        ),
      ],
    });

    expect(outcome.coherenceLevel).toBe("incoerente");
    expect(outcome.track).toBe("track_llm");
  });

  it("routes N/N coherent with a competitor object to track_produto", () => {
    const outcome = computeTriage({
      skus: [{ id: "sku-1", shopify }],
      queries: [
        query(
          {
            cliente_foi_citado: true,
            concorrente_citado_nome: "Other",
            concorrente_citado_url: "https://other.example/p",
            atributos_mencionados_gemini: [],
            preco_citado: 99,
            nome_marca_citada: "Outra Marca",
            produto_mencionado: "Outro Produto",
            objetos_citados: [
              {
                marca: "Outra Marca",
                loja: "Other",
                produto: "Outro Produto",
                url: "https://other.example/p",
                preco: 99,
                moeda: "BRL",
                dimensoes: null,
                qualidade: null,
                prazo_entrega: null,
                avaliacao: null,
                imagem_url: null,
                atributos: [],
              },
            ],
          },
          { cliente_foi_citado: true },
        ),
      ],
    });

    expect(outcome.coherenceLevel).toBe("coerente");
    expect(outcome.track).toBe("track_produto");
    expect(outcome.checks.competitor_cited).toBe(true);
  });

  it("does not treat a competitor name without objetos_citados as track_produto", () => {
    const outcome = computeTriage({
      skus: [{ id: "sku-1", shopify }],
      queries: [
        query(
          {
            cliente_foi_citado: true,
            concorrente_citado_nome: "Athletic Greens",
            concorrente_citado_url: "https://drinkag1.com/products/ag1",
            atributos_mencionados_gemini: [],
            preco_citado: null,
            nome_marca_citada: "Athletic Greens",
            produto_mencionado: "AG1",
            objetos_citados: [],
          },
          { cliente_foi_citado: true },
        ),
      ],
    });

    expect(outcome.coherenceLevel).toBe("coerente");
    expect(outcome.track).toBe("track_pdp");
    expect(outcome.checks.competitor_cited).toBe(false);
  });

  it("does not treat the client's own cited object as track_produto", () => {
    const outcome = computeTriage({
      skus: [{ id: "sku-1", shopify }],
      queries: [
        query(
          {
            cliente_foi_citado: true,
            concorrente_citado_nome: null,
            concorrente_citado_url: null,
            atributos_mencionados_gemini: [],
            preco_citado: 500,
            nome_marca_citada: "Acme",
            produto_mencionado: "Hero Sofa",
            objetos_citados: [
              {
                marca: "Acme",
                loja: "Acme",
                produto: "Hero Sofa",
                url: "https://acme.example/products/hero",
                preco: 500,
                moeda: "BRL",
                dimensoes: null,
                qualidade: null,
                prazo_entrega: null,
                avaliacao: null,
                imagem_url: null,
                atributos: [],
              },
            ],
          },
          { cliente_foi_citado: true },
        ),
      ],
    });

    expect(outcome.coherenceLevel).toBe("coerente");
    expect(outcome.track).toBe("track_pdp");
    expect(outcome.checks.competitor_cited).toBe(false);
  });
});

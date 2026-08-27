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
import { selectDominantSku, selectPrimarySku } from "../src/services/dominant-diagnostic-runner.js";
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

const PASSWORD_STOREFRONT_HTML = `<html><body><p>This store is password protected</p><form action="/password"><input name="password"></form></body></html>`;
const OPEN_PDP_HTML = `<html><head><script type="application/ld+json">{"@type":"Product","name":"Hero Sofa","offers":{"price":"4200","priceCurrency":"BRL"}}</script></head></html>`;

function emptyShopperClient() {
  return stubLlmClient(async () => ({
    rawText: "",
    structured: emptyGeminiStructured(),
    model: "mock",
    mocked: true,
    usedWebSearch: false,
    groundingUrls: [],
    calls: [],
  }));
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
    expect(runner).toContain("planCitedFaceFollowUp");
    expect(runner).toContain("follow_up: true");
    expect(runner).toContain("hydrateCitedOfferImages");
    expect(runner).toContain("vsRivalProductKeys");
    expect(runner).toContain("groundingUrlsForCitedObject");
    expect(runner).toContain("Promise.all");
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
        gemini: emptyShopperClient(),
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

  it("fails the job when an open PDP has no shopper text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(OPEN_PDP_HTML, { status: 200 })),
    );
    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm({ gemini: emptyShopperClient() }),
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

  it("completes track_pdp when the storefront is password-gated and Gemini is silent", async () => {
    const diagnoseQuery = vi.fn(async () => {
      throw new Error("closed storefront must not probe Gemini");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PASSWORD_STOREFRONT_HTML, { status: 200 })),
    );
    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm({ gemini: stubLlmClient(diagnoseQuery) }),
    });
    await seedStore(app);
    const run = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: {
        plan: "essential",
        integration_config: { shopify: { shopDomain: "acme.myshopify.com" } },
      },
    });
    const job = await waitForStatus(app, run.json().job_id, "completed");
    expect(job.error_message).toBeNull();
    expect(diagnoseQuery).not.toHaveBeenCalled();

    const diagnostic = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/${run.json().job_id}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(diagnostic.json().job.status).toBe("completed");
    expect(diagnostic.json().skus[0].shopify_data.meta.storefrontAccess).toBe("password");
    expect(diagnostic.json().triage_result.track_assigned).toBe("track_pdp");
    expect(diagnostic.json().diagnostic.track).toBe("track_pdp");
    expect(diagnostic.json().diagnostic.next_steps.page_brief.move).toBe("abrir_senha");
    expect(String(diagnostic.json().diagnostic.next_steps.first_action)).toContain("senha");
    expect(diagnostic.json().queries).toEqual([]);
  });

  it("persists track_pdp for a password wall even when Shopify is not connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PASSWORD_STOREFRONT_HTML, { status: 200 })),
    );
    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm({ gemini: emptyShopperClient() }),
    });
    await seedStore(app);
    const run = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { plan: "essential" },
    });
    const job = await waitForStatus(app, run.json().job_id, "completed");
    expect(job.error_message).toBeNull();

    const diagnostic = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/${run.json().job_id}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(diagnostic.json().diagnostic).not.toBeNull();
    expect(diagnostic.json().diagnostic.track).toBe("track_pdp");
    expect(diagnostic.json().triage_result.track_assigned).toBe("track_pdp");
    expect(diagnostic.json().diagnostic.next_steps.page_brief.move).toBe("abrir_senha");
    expect(diagnostic.json().skus[0].shopify_data.meta.source).toBe("public_pdp");
    expect(diagnostic.json().skus[0].shopify_data.meta.storefrontAccess).toBe("password");
  });

  it("still completes Página when a sister SKU is open but Gemini is silent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/products/open")) {
          return new Response(OPEN_PDP_HTML, { status: 200 });
        }
        return new Response(PASSWORD_STOREFRONT_HTML, { status: 200 });
      }),
    );
    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm({ gemini: emptyShopperClient() }),
    });
    await seedStore(app);
    const openProduct = await app.inject({
      method: "POST",
      url: `/v1/products?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: {
        url: "https://acme.example/products/open",
        title: "Open Sofa",
        external_ref: "gid://shopify/Product/2",
        position: 2,
      },
    });
    await app.inject({
      method: "POST",
      url: `/v1/prompts?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: {
        prompt_text: "sofá aberto na rua",
        product_id: openProduct.json().product.id,
        sort_order: 1,
      },
    });
    const run = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: {
        plan: "essential",
        integration_config: { shopify: { shopDomain: "acme.myshopify.com" } },
      },
    });
    const job = await waitForStatus(app, run.json().job_id, "completed");
    expect(job.error_message).toBeNull();
    const diagnostic = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/${run.json().job_id}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(diagnostic.json().diagnostic.track).toBe("track_pdp");
    expect(diagnostic.json().diagnostic.next_steps.page_brief.move).toBe("abrir_senha");
    const closedSku = diagnostic
      .json()
      .skus.find((row: { url: string }) => row.url.includes("/products/hero"));
    expect(diagnostic.json().diagnostic.sku_id).toBe(closedSku.id);
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

  it("ADR-003 residual gap, end-to-end: stamps per-object grounding through the real Gemini-response pipeline, not hand-set test data", async () => {
    // Every other coverage of this fix (gemini-grounding.test.ts, the computeTriage test below)
    // constructs `objetos_citados` with `grounding_confirmed_client` already set by hand. This
    // test is the one place that proves the real wiring — bindGroundingSupports →
    // objectGroundingVerdicts → stampObjectsGrounding, run from an actual mocked Gemini response
    // — produces the correct per-object stamp end to end. Client "Acme" and a co-mentioned
    // lookalike competitor "Acme Studio" (a text-prefix collision, the shape that broke the
    // naive first version of this fix) appear in the same answer; only Acme's own sentence
    // resolves to the client's host.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(OPEN_PDP_HTML, { status: 200 })),
    );
    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm({
        gemini: stubLlmClient(async () => ({
          rawText:
            "A Acme vende o Hero Sofa por R$500 direto no site. A Acme Studio também vende um Sofá Modular parecido por R$50.",
          structured: {
            ...emptyGeminiStructured(),
            cliente_foi_citado: true,
            objetos_citados: [
              {
                marca: "Acme",
                loja: null,
                produto: "Hero Sofa",
                url: null,
                preco: 500,
                moeda: "BRL",
                dimensoes: null,
                qualidade: null,
                prazo_entrega: null,
                avaliacao: null,
                imagem_url: null,
                atributos: [],
              },
              {
                marca: "Acme Studio",
                loja: null,
                produto: "Sofá Modular",
                url: null,
                preco: 50,
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
          model: "gemini-2.5-flash",
          mocked: false,
          usedWebSearch: true,
          groundingUrls: ["https://acme.example/products/hero", "https://acmestudio.example/sofa"],
          groundingSupports: [
            {
              text: "A Acme vende o Hero Sofa por R$500 direto no site.",
              uris: ["https://acme.example/products/hero"],
            },
            {
              text: "A Acme Studio também vende um Sofá Modular parecido por R$50.",
              uris: ["https://acmestudio.example/sofa"],
            },
          ],
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
    await waitForStatus(app, run.json().job_id, "completed");
    const diagnostic = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/${run.json().job_id}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    const objects = diagnostic.json().queries[0].gemini_structured.objetos_citados as Array<{
      marca: string;
      grounding_confirmed_client?: boolean;
    }>;
    expect(objects.find((object) => object.marca === "Acme")?.grounding_confirmed_client).toBe(
      true,
    );
    expect(
      objects.find((object) => object.marca === "Acme Studio")?.grounding_confirmed_client,
    ).toBe(false);
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

  it("prefers a closed storefront over a sister with a bigger citation gap", () => {
    const openMeta = {
      source: "public_pdp",
      fetchedAt: "2026-08-20T00:00:00.000Z",
      storefrontAccess: "open" as const,
    };
    const closedMeta = {
      source: "public_pdp",
      fetchedAt: "2026-08-20T00:00:00.000Z",
      storefrontAccess: "password" as const,
    };
    const baseShopify = {
      url: "https://acme.example/products/hero",
      name: "Hero",
      brand: null,
      currentPrice: 1,
      currency: "BRL",
      attributes: [],
      variants: [],
      inventoryAvailable: null,
      image: null,
    };
    const skus = [
      {
        row: {
          id: "sku-open",
          product_id: "product-open",
          shopify_data: {
            ...baseShopify,
            url: "https://acme.example/products/open",
            meta: openMeta,
          },
        },
        product: { id: "product-open" },
        prompts: [],
      },
      {
        row: {
          id: "sku-closed",
          product_id: "product-closed",
          shopify_data: {
            ...baseShopify,
            url: "https://acme.example/products/closed",
            meta: closedMeta,
          },
        },
        product: { id: "product-closed" },
        prompts: [],
      },
    ] as any;
    const queries = [
      {
        sku_id: "sku-open",
        cliente_foi_citado: false,
        concorrente_citado_nome: "Competitor",
        concorrente_citado_url: "https://competitor.example/p",
      },
    ] as any;

    const result = selectPrimarySku(skus, queries);
    expect(result.primary.row.id).toBe("sku-closed");
    expect(result.selection).toMatchObject({
      strategy: "closed_storefront_first",
      selected_sku_id: "sku-closed",
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
    meta: { port: "test", source: "test", fetchedAt: new Date().toISOString() },
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
    expect(outcome.coherenceIncident).toEqual({
      kind: "price",
      said: "R$ 99",
      catalog: "R$ 500",
    });
  });

  it("names a storefront brand incident when the cited name is not the catalog", () => {
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
            nome_marca_citada: "Outra Marca",
            produto_mencionado: "X",
            objetos_citados: [
              {
                marca: "Outra Marca",
                loja: null,
                produto: "X",
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

    expect(outcome.coherenceLevel).toBe("incoerente");
    expect(outcome.coherenceIncident).toEqual({
      kind: "brand",
      said: "Outra Marca",
      catalog: "Acme",
    });
  });

  it("does not treat a marketplace listing price as the client storefront", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            name: "Multivitamínico Para Usuários de Caneta ou Bariátrico | 23 Nutrientes",
            brand: "CompleteBari",
            url: "https://completebari.com.br/products/multivitaminico-complete-bari-multi",
            currentPrice: 129.9,
          },
        },
      ],
      queries: [
        query(
          {
            cliente_foi_citado: true,
            concorrente_citado_nome: "Mercado Livre",
            concorrente_citado_url: null,
            atributos_mencionados_gemini: [],
            preco_citado: 71.01,
            nome_marca_citada: null,
            produto_mencionado: "Multivitamínico Beleza Saúde Body Bari Pós-Cirurgia Bariátrica",
            objetos_citados: [
              {
                marca: null,
                loja: "Mercado Livre",
                produto: "Multivitamínico Beleza Saúde Body Bari Pós-Cirurgia Bariátrica",
                url: null,
                preco: 71.01,
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

    expect(outcome.coherenceLevel).not.toBe("incoerente");
    expect(outcome.coherenceIncident).toBeNull();
  });

  it("does not compare a reseller shelf price to the Shopify PDP", () => {
    const outcome = computeTriage({
      skus: [{ id: "sku-1", shopify }],
      queries: [
        query(
          {
            cliente_foi_citado: true,
            concorrente_citado_nome: "Marketplace",
            concorrente_citado_url: "https://marketplace.example/listing/123",
            atributos_mencionados_gemini: [],
            preco_citado: 50,
            nome_marca_citada: "Acme",
            produto_mencionado: "Hero Sofa",
            objetos_citados: [
              {
                marca: "Acme",
                loja: "Marketplace",
                produto: "Hero Sofa",
                url: "https://marketplace.example/listing/123",
                preco: 50,
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

    expect(outcome.coherenceLevel).not.toBe("incoerente");
    expect(outcome.coherenceIncident).toBeNull();
  });

  it("does not treat Complete Bari vs CompleteBari as a brand incident", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            name: "Multivitamínico Complete Bari Multi",
            brand: "CompleteBari",
            url: "https://completebari.com.br/products/multivitaminico-complete-bari-multi",
            currentPrice: 129.9,
          },
        },
      ],
      queries: [
        query(
          {
            cliente_foi_citado: true,
            concorrente_citado_nome: null,
            concorrente_citado_url: null,
            atributos_mencionados_gemini: [],
            preco_citado: 129.9,
            nome_marca_citada: "Complete Bari",
            produto_mencionado: "Multi",
            objetos_citados: [
              {
                marca: "Complete Bari",
                loja: "Complete Bari",
                produto: "Multi",
                url: "https://completebari.com.br/products/multivitaminico-complete-bari-multi",
                preco: 129.9,
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

    expect(outcome.coherenceLevel).not.toBe("incoerente");
    expect(outcome.coherenceIncident).toBeNull();
  });

  it("lists occupants from lost queries, not the job crown", () => {
    const outcome = computeTriage({
      skus: [{ id: "sku-1", shopify }],
      queries: [
        query({
          cliente_foi_citado: false,
          concorrente_citado_nome: "Biostévi",
          concorrente_citado_url: "https://drogaraia.com.br/biostevi",
          atributos_mencionados_gemini: [],
          preco_citado: 149.9,
          nome_marca_citada: "Biostévi Nutrition",
          produto_mencionado: "Biostévi",
          objetos_citados: [
            {
              marca: "Biostévi Nutrition",
              loja: "Droga Raia",
              produto: "Biostévi",
              url: "https://drogaraia.com.br/biostevi",
              preco: 149.9,
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
        {
          ...query({
            cliente_foi_citado: false,
            concorrente_citado_nome: "Centrum",
            concorrente_citado_url: "https://beltnutrition.com.br/centrum",
            atributos_mencionados_gemini: [],
            preco_citado: 89,
            nome_marca_citada: "Centrum",
            produto_mencionado: "Centrum Bariátrico",
            objetos_citados: [
              {
                marca: "Centrum",
                loja: "Belt Nutrition",
                produto: "Centrum Bariátrico",
                url: "https://beltnutrition.com.br/centrum",
                preco: 89,
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
          id: "q2",
        },
      ],
    });

    expect(outcome.checks.lost_occupants).toEqual([
      { name: "Biostévi Nutrition", href: "https://drogaraia.com.br/biostevi" },
      { name: "Centrum Bariátrico", href: "https://beltnutrition.com.br/centrum" },
    ]);
    expect(outcome.checks.lost_occupant_speech).toEqual({ kind: "several" });
  });

  it("does not fabricate incoherence from a name-only fuzzy match when grounding says this query did not cite the client", () => {
    // `objetos_citados` has an off-domain object whose `marca` fuzzy-matches the client
    // brand ("Acme") by coincidence, but `cliente_foi_citado: false` means grounding never
    // resolved this query to the client's own host. Before the fix, the fuzzy match alone
    // pulled this object into the coherence check and its mismatched price flipped
    // coherenceLevel to "incoerente" — a false "the client lied about their own price"
    // signal for an object that was never actually the client. The citation gap (0/N)
    // still correctly routes to track_llm either way — coherenceLevel is what changes.
    const outcome = computeTriage({
      skus: [{ id: "sku-1", shopify }],
      queries: [
        query({
          cliente_foi_citado: false,
          concorrente_citado_nome: "Acme",
          concorrente_citado_url: "https://marketplace.example/listing/123",
          atributos_mencionados_gemini: [],
          preco_citado: 50,
          nome_marca_citada: "Acme",
          produto_mencionado: "Hero Sofa",
          objetos_citados: [
            {
              marca: "Acme",
              loja: "Marketplace",
              produto: "Hero Sofa",
              url: "https://marketplace.example/listing/123",
              preco: 50,
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
    expect(outcome.checks.comparisons).toMatchObject([
      { price_matches: null, brand_matches: null },
    ]);
    expect(outcome.track).toBe("track_llm");
  });

  it("trusts a minority execution's grounding over the query-level majority vote (ADR-003 multi-execution gap)", () => {
    // Pro-tier query (3 executions): 1 execution genuinely grounded the client, 2 did not —
    // the aggregate `cliente_foi_citado` is `false` (majority vote), but the merged
    // `objetos_citados` entry is stamped `grounding_confirmed_client: true`. No storefront
    // URL (Gemini's `url` field is often empty) — the object still enters the client set
    // via marca/produto + the per-object flag. Price 3.1.1 does not run without the
    // client's own host (a URL-less marketplace listing must not become “Falou R$ X na loja”).
    // Brand 3.1.3 is storefront-only too — without the host, brand_matches stays null.
    const outcome = computeTriage({
      skus: [{ id: "sku-1", shopify }],
      queries: [
        query({
          cliente_foi_citado: false,
          concorrente_citado_nome: null,
          concorrente_citado_url: null,
          atributos_mencionados_gemini: [],
          preco_citado: 199,
          nome_marca_citada: shopify.brand,
          produto_mencionado: shopify.name,
          objetos_citados: [
            {
              marca: shopify.brand,
              loja: shopify.name,
              produto: shopify.name,
              url: null,
              preco: 199,
              moeda: "BRL",
              dimensoes: null,
              qualidade: null,
              prazo_entrega: null,
              avaliacao: null,
              imagem_url: null,
              atributos: [],
              grounding_confirmed_client: true,
            },
          ],
        }),
      ],
    });

    expect(outcome.checks.comparisons).toMatchObject([
      { price_matches: null, brand_matches: null },
    ]);
    expect(outcome.coherenceLevel).toBe("coerente");
  });

  it("closes the same-query co-mention gap (ADR-003 residual gap): a grounding-confirmed query can still list a competitor object", () => {
    // `cliente_foi_citado: true` — grounding confirmed THIS query cited the client overall.
    // But `objetos_citados` lists two objects: the client's own product, and a co-mentioned
    // competitor ("Acme Studio") whose name fuzzy-matches the client brand ("Acme") by
    // coincidence. `objectHostMatchFromSupports` (gemini-grounding.ts), stamped per object in
    // `recordDiagnoseExecution` before this data ever reaches computeTriage, correctly marks
    // the competitor `grounding_confirmed_client: false` — its own grounded sentence resolved
    // to a different host — while the client's own object is `true`. Before this fix, only a
    // single per-execution boolean existed and every object in a cited query shared it, so the
    // competitor's wrong price would have wrongly flipped coherence to "incoerente".
    const outcome = computeTriage({
      skus: [{ id: "sku-1", shopify }],
      queries: [
        query({
          cliente_foi_citado: true,
          concorrente_citado_nome: "Acme Studio",
          concorrente_citado_url: "https://acmestudio.example/sofa",
          atributos_mencionados_gemini: [],
          preco_citado: 500,
          nome_marca_citada: "Acme",
          produto_mencionado: "Hero Sofa",
          objetos_citados: [
            {
              marca: "Acme",
              loja: null,
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
              grounding_confirmed_client: true,
            },
            {
              marca: "Acme Studio",
              loja: null,
              produto: "Sofá Modular",
              url: "https://acmestudio.example/sofa",
              preco: 50,
              moeda: "BRL",
              dimensoes: null,
              qualidade: null,
              prazo_entrega: null,
              avaliacao: null,
              imagem_url: null,
              atributos: [],
              grounding_confirmed_client: false,
            },
          ],
        }),
      ],
    });

    // The competitor's mismatched price (50 vs the client's real 500) never enters the
    // comparison — only the client's own, correctly-priced object does.
    expect(outcome.checks.comparisons).toMatchObject([{ price_matches: true }]);
    expect(outcome.coherenceLevel).toBe("coerente");
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

  it("keeps Product before Media when CAC is high and a competitor object exists", () => {
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
      mediaSignals: {
        meta: {
          externalRef: "sku-1",
          spend: 1000,
          conversions: 2,
          cac: 800,
          meta: { port: "test", source: "test", fetchedAt: new Date().toISOString() },
        },
        shopifyRevenue: {
          externalRef: "sku-1",
          revenue: 5000,
          orders: 10,
          ticketMedio: 500,
          meta: { port: "test", source: "test", fetchedAt: new Date().toISOString() },
        },
      },
    });

    expect(outcome.track).toBe("track_produto");
    expect(outcome.checks.media_waste_detected).toBe(true);
    expect(outcome.checks.competitor_cited).toBe(true);
  });

  it("routes N/N coherent Meta waste (CAC > card) to track_midia when no competitor object", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            meta: {
              ...shopify.meta,
              source: "shopify_api",
              storefrontAccess: "open",
              hasJsonLd: true,
            },
          },
        },
      ],
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
            objetos_citados: [],
          },
          { cliente_foi_citado: true },
        ),
      ],
      mediaSignals: {
        meta: {
          externalRef: "sku-1",
          spend: 1000,
          conversions: 2,
          cac: 800,
          meta: { port: "test", source: "test", fetchedAt: new Date().toISOString() },
        },
        shopifyRevenue: {
          externalRef: "sku-1",
          revenue: 5000,
          orders: 10,
          ticketMedio: 500,
          meta: { port: "test", source: "test", fetchedAt: new Date().toISOString() },
        },
      },
    });

    expect(outcome.track).toBe("track_midia");
    expect(outcome.checks.media_waste_detected).toBe(true);
  });

  it("routes spend with zero purchases to track_midia", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            meta: {
              ...shopify.meta,
              source: "shopify_api",
              storefrontAccess: "open",
              hasJsonLd: true,
            },
          },
        },
      ],
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
            objetos_citados: [],
          },
          { cliente_foi_citado: true },
        ),
      ],
      mediaSignals: {
        meta: {
          externalRef: "sku-1",
          spend: 500,
          conversions: 0,
          cac: 0,
          meta: { port: "test", source: "test", fetchedAt: new Date().toISOString() },
        },
        shopifyRevenue: {
          externalRef: "sku-1",
          revenue: 5000,
          orders: 10,
          ticketMedio: 500,
          meta: { port: "test", source: "test", fetchedAt: new Date().toISOString() },
        },
      },
    });

    expect(outcome.track).toBe("track_midia");
    expect(outcome.checks.media_waste_detected).toBe(true);
  });

  it("does not let Google Ads wastedSpend pick the week", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            meta: {
              ...shopify.meta,
              source: "shopify_api",
              storefrontAccess: "open",
              hasJsonLd: true,
            },
          },
        },
      ],
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
            objetos_citados: [],
          },
          { cliente_foi_citado: true },
        ),
      ],
      mediaSignals: {
        googleAds: {
          externalRef: "sku-1",
          spend: 2000,
          roas: 0.1,
          breakEvenRoas: 2,
          wastedSpend: 999,
          clickVolumeWithoutConversion: 40,
          meta: { port: "test", source: "test", fetchedAt: new Date().toISOString() },
        },
      },
    });

    expect(outcome.checks.media_waste_detected).toBe(false);
    expect(outcome.track).not.toBe("track_midia");
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

  it("routes panel mismatch to track_pdp", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            meta: {
              ...shopify.meta,
              source: "public_pdp",
              storefrontAccess: "open",
              hasJsonLd: true,
              panelMismatch: true,
              shopConnected: true,
            },
          },
        },
      ],
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
            objetos_citados: [],
          },
          { cliente_foi_citado: true },
        ),
      ],
    });
    expect(outcome.track).toBe("track_pdp");
  });

  it("routes thin Admin catalog to track_llm, not track_pdp", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            descriptionChars: 20,
            attributes: ["x"],
            meta: {
              ...shopify.meta,
              source: "shopify_api",
              storefrontAccess: "open",
              hasJsonLd: true,
              admin: {
                attributeCount: 1,
                descriptionChars: 20,
                hasMaterial: false,
                hasColor: false,
                hasDimension: false,
                hasImageAlt: true,
                thin: true,
                gaps: ["attributes", "description"],
              },
            },
          },
        },
      ],
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
            objetos_citados: [],
          },
          { cliente_foi_citado: true },
        ),
      ],
    });
    expect(outcome.track).toBe("track_llm");
  });

  it("routes missing street JSON-LD to track_pdp even when Admin catalog is thin", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            descriptionChars: 20,
            attributes: ["x"],
            meta: {
              ...shopify.meta,
              source: "shopify_api",
              storefrontAccess: "open",
              hasJsonLd: false,
              admin: {
                attributeCount: 1,
                descriptionChars: 20,
                hasMaterial: false,
                hasColor: false,
                hasDimension: false,
                hasImageAlt: true,
                thin: true,
                gaps: ["attributes", "description"],
              },
            },
          },
        },
      ],
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
            objetos_citados: [],
          },
          { cliente_foi_citado: true },
        ),
      ],
    });
    expect(outcome.track).toBe("track_pdp");
  });

  it("keeps 0/N on track_llm even when the street has no JSON-LD", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            meta: {
              ...shopify.meta,
              source: "shopify_api",
              storefrontAccess: "open",
              hasJsonLd: false,
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
    expect(outcome.track).toBe("track_llm");
  });

  it("routes an open street without JSON-LD to track_pdp", () => {
    const outcome = computeTriage({
      skus: [
        {
          id: "sku-1",
          shopify: {
            ...shopify,
            meta: {
              ...shopify.meta,
              source: "shopify_api",
              storefrontAccess: "open",
              hasJsonLd: false,
            },
          },
        },
      ],
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
            objetos_citados: [],
          },
          { cliente_foi_citado: true },
        ),
      ],
    });
    expect(outcome.track).toBe("track_pdp");
  });
});

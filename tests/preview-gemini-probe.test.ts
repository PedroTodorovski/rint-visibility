import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emptyCitedObject, emptyGeminiStructured } from "../src/lib/llm/gemini-structured.js";
import type { LlmClients, LlmStructuredDiagnosticResult } from "../src/lib/llm/types.js";
import { authHeaders } from "../src/lib/request.js";
import { PreviewGeminiProbeStore } from "../src/services/preview-gemini-probe.js";

const TEST_API_KEY = "test-visibility-api-key";
const WORKSPACE_ID = "ws_preview_gemini";

function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "3010",
    VISIBILITY_API_KEY: TEST_API_KEY,
    ...overrides,
  });
}

function liveResult(query: string): LlmStructuredDiagnosticResult {
  const branded = /nuture/i.test(query);
  return {
    rawText: branded
      ? "O Nuture Daily Boost aparece nas buscas da Nuture em nuture.com.br."
      : "Reviews citam o AG1 da Athletic Greens para greens no Brasil.",
    structured: {
      ...emptyGeminiStructured(),
      cliente_foi_citado: branded,
      concorrente_citado_nome: branded ? null : "Athletic Greens",
      nome_marca_citada: branded ? "Nuture" : "Athletic Greens",
      objetos_citados: [
        {
          ...emptyCitedObject(),
          marca: branded ? "Nuture" : "Athletic Greens",
          produto: branded ? "Daily Boost" : "AG1",
          loja: branded ? "Nuture" : "Athletic Greens",
        },
      ],
    },
    model: "gemini-2.0-flash",
    mocked: false,
    usedWebSearch: true,
    groundingUrls: branded
      ? ["https://nuture.com.br/products/nuture-daily-boost"]
      : ["https://drinkag1.com/products/ag1"],
    calls: [
      { type: "text", usedWebSearch: true, model: "gemini-2.0-flash" },
      { type: "structure", usedWebSearch: true, model: "gemini-2.0-flash" },
    ],
  };
}

function mockLlm(): LlmClients {
  return {
    gemini: {
      async probe() {
        return { text: "", model: "mock", mocked: true };
      },
      async probeBatch() {
        return { responses: [], model: "mock", mocked: true };
      },
      async diagnoseQuery(input) {
        return liveResult(input.query);
      },
    },
  };
}

const payload = {
  store: { name: "Nuture", domain: "nuture.com.br" },
  queries: [
    {
      sku_id: "nuture-daily-boost",
      query_text: "Melhor suplemento de greens no Brasil",
      product_url: "https://nuture.com.br/products/nuture-daily-boost",
      product_name: "Nuture Daily Boost",
      product_attributes: ["59 vitaminas"],
    },
    {
      sku_id: "nuture-daily-boost",
      query_text: "Nuture Daily Boost vale a pena",
      product_url: "https://nuture.com.br/products/nuture-daily-boost",
      product_name: "Nuture Daily Boost",
      product_attributes: ["59 vitaminas"],
    },
  ],
};

async function waitForRun(
  app: Awaited<ReturnType<typeof buildApp>>,
  runId: string,
  status: "completed" | "failed",
) {
  for (let i = 0; i < 40; i++) {
    const response = await app.inject({
      method: "GET",
      url: `/v1/preview/gemini-probe/${runId}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    if (response.statusCode === 200 && response.json().status === status) {
      return response.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`preview probe did not reach ${status}`);
}

describe("POST /v1/preview/gemini-probe", () => {
  it("returns 503 when Gemini is not configured and no llm is injected", async () => {
    const app = await buildApp(testConfig());
    const response = await app.inject({
      method: "POST",
      url: `/v1/preview/gemini-probe?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("GEMINI_NOT_CONFIGURED");
  });

  it("runs diagnoseQuery without creating a diagnostic job", async () => {
    const app = await buildApp(testConfig(), {
      llm: mockLlm(),
      previewProbeStore: new PreviewGeminiProbeStore(),
    });

    const started = await app.inject({
      method: "POST",
      url: `/v1/preview/gemini-probe?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload,
    });
    expect(started.statusCode).toBe(202);
    expect(started.json().status).toBe("running");
    expect(started.json().total).toBe(2);

    const jobs = await app.inject({
      method: "GET",
      url: `/v1/jobs?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(jobs.statusCode).toBe(503);

    const run = await waitForRun(app, started.json().id, "completed");
    expect(run.queries).toHaveLength(2);
    expect(run.queries.every((query: { mocked: boolean }) => query.mocked === false)).toBe(true);
    expect(run.queries[0].query_text).toBe("Melhor suplemento de greens no Brasil");
    expect(run.queries[0].gemini_raw).toMatch(/Athletic Greens/);
    expect(run.queries[1].gemini_raw).toMatch(/Nuture Daily Boost/);
    expect(run.queries[0].cliente_foi_citado).toBe(false);
    expect(run.queries[1].cliente_foi_citado).toBe(true);
    expect(
      run.queries.every((query: { executions: unknown[] }) => query.executions.length === 1),
    ).toBe(true);
  });

  it("asks where to buy on every answer that names the brand without the store", async () => {
    const llm = mockLlm();
    const original = llm.gemini.diagnoseQuery!;
    llm.gemini.diagnoseQuery = async (input) => {
      if (/Em qual site/i.test(input.query)) {
        return {
          rawText: "O Daily Boost se compra no site oficial da Nuture.",
          structured: {
            ...emptyGeminiStructured(),
            cliente_foi_citado: true,
            nome_marca_citada: "Nuture",
          },
          model: "gemini-2.0-flash",
          mocked: false,
          usedWebSearch: true,
          groundingUrls: ["https://nuture.com.br/products/nuture-daily-boost"],
          calls: [
            { type: "text", usedWebSearch: true, model: "gemini-2.0-flash" },
            { type: "structure", usedWebSearch: true, model: "gemini-2.0-flash" },
          ],
        };
      }
      if (/alternativa ao AG1/i.test(input.query)) {
        return {
          rawText: "O Nuture Daily Boost é a alternativa nacional ao AG1.",
          structured: {
            ...emptyGeminiStructured(),
            cliente_foi_citado: false,
            nome_marca_citada: "Nuture",
          },
          model: "gemini-2.0-flash",
          mocked: false,
          usedWebSearch: true,
          groundingUrls: ["https://drinkag1.com/products/ag1"],
          calls: [
            { type: "text", usedWebSearch: true, model: "gemini-2.0-flash" },
            { type: "structure", usedWebSearch: true, model: "gemini-2.0-flash" },
          ],
        };
      }
      return original(input);
    };

    const app = await buildApp(testConfig(), {
      llm,
      previewProbeStore: new PreviewGeminiProbeStore(),
    });
    const started = await app.inject({
      method: "POST",
      url: `/v1/preview/gemini-probe?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: {
        store: { name: "Nuture", domain: "nuture.com.br" },
        queries: [
          {
            sku_id: "nuture-daily-boost",
            query_text: "Alternativa ao AG1 com vitaminas e minerais",
            product_url: "https://nuture.com.br/products/nuture-daily-boost",
            product_name: "Nuture Daily Boost",
            product_attributes: ["59 vitaminas"],
          },
          {
            sku_id: "nuture-daily-boost",
            query_text: "Melhor suplemento de greens no Brasil",
            product_url: "https://nuture.com.br/products/nuture-daily-boost",
            product_name: "Nuture Daily Boost",
            product_attributes: ["59 vitaminas"],
          },
        ],
      },
    });
    const run = await waitForRun(app, started.json().id, "completed");
    expect(run.queries).toHaveLength(2);
    const named = run.queries.find((query: { query_text: string }) =>
      /alternativa ao AG1/i.test(query.query_text),
    );
    const generic = run.queries.find((query: { query_text: string }) =>
      /greens no Brasil/i.test(query.query_text),
    );
    expect(named.executions.some((row: { follow_up?: boolean }) => row.follow_up)).toBe(true);
    expect(generic.executions.some((row: { follow_up?: boolean }) => row.follow_up)).toBe(false);
  });

  it("persists first-pass grounding supports on the execution", async () => {
    const llm = mockLlm();
    llm.gemini.diagnoseQuery = async () => ({
      ...liveResult("Melhor suplemento de greens no Brasil"),
      groundingSupports: [
        {
          text: "Reviews citam o AG1 da Athletic Greens para greens no Brasil.",
          uris: ["https://drinkag1.com/products/ag1"],
        },
      ],
    });

    const app = await buildApp(testConfig(), {
      llm,
      previewProbeStore: new PreviewGeminiProbeStore(),
    });
    const started = await app.inject({
      method: "POST",
      url: `/v1/preview/gemini-probe?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: {
        store: { name: "Nuture", domain: "nuture.com.br" },
        queries: [payload.queries[0]],
      },
    });
    const run = await waitForRun(app, started.json().id, "completed");
    expect(run.queries[0].executions[0].grounding_supports).toEqual([
      {
        text: "Reviews citam o AG1 da Athletic Greens para greens no Brasil.",
        hosts: ["drinkag1.com"],
        hrefs: ["https://drinkag1.com/products/ag1"],
      },
    ]);
  });
});

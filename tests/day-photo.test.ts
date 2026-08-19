import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  emptyGeminiStructured,
  hydrateGeminiStructured,
} from "../src/lib/llm/gemini-structured.js";
import { authHeaders } from "../src/lib/request.js";
import type {
  DiagnosticQueryRow,
  DiagnosticSkuRow,
  JobRow,
} from "../src/repositories/diagnostic-tables.js";
import {
  buildDayPhotoIndex,
  copyDayPhotoQuery,
  dayPhotoPairKey,
  findIdenticalDayPhotoSet,
  fingerprintDayPhotoPairs,
  isDayPhotoCopy,
  lookupDayPhotoPair,
  normalizeDayPhotoQuery,
  normalizeDayPhotoUrl,
} from "../src/services/day-photo.js";
import { liveLlm } from "./helpers/live-llm.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    store_id: "store-1",
    probe_run_id: "run-1",
    status: "completed",
    plan: "essential",
    webhook_url: null,
    config_snapshot: {},
    error_message: null,
    created_at: "2026-08-18T12:00:00.000Z",
    updated_at: "2026-08-18T12:05:00.000Z",
    started_at: "2026-08-18T12:00:00.000Z",
    completed_at: "2026-08-18T12:05:00.000Z",
    ...overrides,
  };
}

function sku(overrides: Partial<DiagnosticSkuRow> = {}): DiagnosticSkuRow {
  return {
    id: "sku-1",
    job_id: "job-1",
    product_id: "p-1",
    url: "https://acme.example/products/hero",
    external_ref: null,
    shopify_data: {
      externalRef: null,
      url: "https://acme.example/products/hero",
      name: "Hero",
      brand: "Acme",
      currentPrice: 10,
      currency: "BRL",
      attributes: [],
      variants: [],
      inventoryAvailable: null,
      image: null,
      meta: { source: "public_pdp", fetchedAt: "2026-08-18T12:00:00.000Z", hasOg: false },
    },
    validation_status: "valid",
    validation_errors: [],
    created_at: "2026-08-18T12:00:00.000Z",
    ...overrides,
  };
}

function query(overrides: Partial<DiagnosticQueryRow> = {}): DiagnosticQueryRow {
  return {
    id: "q-1",
    job_id: "job-1",
    sku_id: "sku-1",
    prompt_id: "prompt-1",
    query_text: "melhor sofá modular",
    gemini_raw: "resposta",
    gemini_structured: hydrateGeminiStructured({
      ...emptyGeminiStructured(),
      cliente_foi_citado: false,
    }),
    cliente_foi_citado: false,
    concorrente_citado_nome: null,
    concorrente_citado_url: null,
    atributos_mencionados_gemini: [],
    temperatura_gemini: 0,
    num_execucoes: 1,
    confianca: null,
    executions: [
      {
        raw_text: "resposta",
        measured_at: "2026-08-18T12:01:00.000Z",
      },
    ],
    created_at: "2026-08-18T12:01:00.000Z",
    ...overrides,
  };
}

describe("day photo", () => {
  it("treats case, accents, and extra spaces as the same question", () => {
    expect(normalizeDayPhotoQuery("  Melhor Sofá  Modular ")).toBe(
      normalizeDayPhotoQuery("melhor sofa modular"),
    );
  });

  it("normalizes product URLs before matching", () => {
    expect(normalizeDayPhotoUrl("HTTP://WWW.Acme.example/products/hero/")).toBe(
      "https://acme.example/products/hero",
    );
    expect(dayPhotoPairKey("https://acme.example/products/hero", "Melhor Sofá")).toBe(
      dayPhotoPairKey("https://www.acme.example/products/hero/", "melhor sofa"),
    );
  });

  it("fingerprints a set without caring about pair order", () => {
    expect(
      fingerprintDayPhotoPairs([
        { url: "https://a.example/p/1", query: "q2" },
        { url: "https://a.example/p/1", query: "q1" },
      ]),
    ).toBe(
      fingerprintDayPhotoPairs([
        { url: "https://a.example/p/1", query: "q1" },
        { url: "https://a.example/p/1", query: "q2" },
      ]),
    );
  });

  it("indexes today's completed pairs and reuses the earliest measurement", () => {
    const now = new Date("2026-08-18T16:00:00-03:00");
    const index = buildDayPhotoIndex({
      now,
      jobs: [
        job(),
        job({
          id: "job-2",
          completed_at: "2026-08-18T15:00:00.000Z",
        }),
      ],
      skus: [sku(), sku({ id: "sku-2", job_id: "job-2" })],
      queries: [
        query(),
        query({
          id: "q-2",
          job_id: "job-2",
          sku_id: "sku-2",
          executions: [{ raw_text: "depois", measured_at: "2026-08-18T15:00:00.000Z" }],
        }),
      ],
    });

    expect(index.pairs).toHaveLength(1);
    expect(
      lookupDayPhotoPair(index, "https://acme.example/products/hero", "melhor sofa modular")
        ?.query_id,
    ).toBe("q-1");
    expect(
      findIdenticalDayPhotoSet(
        index,
        fingerprintDayPhotoPairs([{ url: sku().url, query: query().query_text }]),
      )?.job_id,
    ).toBe("job-1");
  });

  it("does not index empty or mocked shopper evidence", () => {
    const now = new Date("2026-08-18T16:00:00-03:00");
    const index = buildDayPhotoIndex({
      now,
      jobs: [job()],
      skus: [sku()],
      queries: [
        query({
          gemini_raw: "",
          executions: [{ raw_text: "", mocked: true, measured_at: "2026-08-18T12:01:00.000Z" }],
        }),
      ],
    });
    expect(index.pairs).toHaveLength(0);
    expect(
      findIdenticalDayPhotoSet(
        index,
        fingerprintDayPhotoPairs([{ url: sku().url, query: query().query_text }]),
      ),
    ).toBeNull();
  });

  it("ignores jobs from yesterday", () => {
    const now = new Date("2026-08-18T16:00:00-03:00");
    const index = buildDayPhotoIndex({
      now,
      jobs: [job({ completed_at: "2026-08-17T20:00:00.000Z" })],
      skus: [sku()],
      queries: [query()],
    });
    expect(index.pairs).toHaveLength(0);
  });

  it("copies evidence and stamps the original measurement", () => {
    const copied = copyDayPhotoQuery({
      source: query(),
      jobId: "job-new",
      skuId: "sku-new",
      promptId: "prompt-new",
      queryText: "Melhor Sofá Modular",
    });
    expect(copied.job_id).toBe("job-new");
    expect(copied.gemini_raw).toBe("resposta");
    expect(isDayPhotoCopy(copied)).toBe(true);
    expect(copied.executions[0]?.from_query_id).toBe("q-1");
    expect(copied.executions[0]?.measured_at).toBe("2026-08-18T12:01:00.000Z");
  });
});

const TEST_API_KEY = "test-visibility-api-key";
const WORKSPACE_ID = "ws_day_photo";

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
      position: 1,
    },
  });
  const created = await app.inject({
    method: "POST",
    url: `/v1/prompts?workspace_id=${WORKSPACE_ID}`,
    headers: authHeaders(TEST_API_KEY),
    payload: {
      prompt_text: "melhor sofá modular para apartamento",
      product_id: product.json().product.id,
      sort_order: 1,
    },
  });
  return {
    productId: product.json().product.id as string,
    promptId: created.json().prompt.id as string,
  };
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

describe("day photo API", () => {
  it("returns the completed diagnosis when the same test runs again today", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm(),
    });
    await seedStore(app);

    const first = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { plan: "essential" },
    });
    expect(first.statusCode).toBe(202);
    await waitForStatus(app, first.json().job_id, "completed");

    const photos = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/day-photos?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(photos.statusCode).toBe(200);
    expect(photos.json().pairs).toHaveLength(1);

    const second = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { plan: "essential" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().reused).toBe(true);
    expect(second.json().job_id).toBe(first.json().job_id);
  });

  it("copies today's pair when one question changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    const app = await buildApp(testConfig(), {
      repositories: createMemoryRepositories(),
      llm: liveLlm(),
    });
    const seeded = await seedStore(app);

    const first = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { plan: "essential" },
    });
    await waitForStatus(app, first.json().job_id, "completed");

    await app.inject({
      method: "POST",
      url: `/v1/prompts?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: {
        prompt_text: "sofá modular para sala pequena",
        product_id: seeded.productId,
        sort_order: 2,
      },
    });

    const second = await app.inject({
      method: "POST",
      url: `/v1/diagnostics/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { plan: "essential" },
    });
    expect(second.statusCode).toBe(202);
    expect(second.json().job_id).not.toBe(first.json().job_id);
    await waitForStatus(app, second.json().job_id, "completed");

    const diagnostic = await app.inject({
      method: "GET",
      url: `/v1/diagnostics/${second.json().job_id}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    const queries = diagnostic.json().queries as Array<{
      query_text: string;
      executions: Array<{ from_query_id?: string }>;
    }>;
    expect(queries).toHaveLength(2);
    const copied = queries.filter((row) =>
      row.executions.some((execution) => typeof execution.from_query_id === "string"),
    );
    const fresh = queries.filter(
      (row) => !row.executions.some((execution) => typeof execution.from_query_id === "string"),
    );
    expect(copied).toHaveLength(1);
    expect(fresh).toHaveLength(1);
  });
});

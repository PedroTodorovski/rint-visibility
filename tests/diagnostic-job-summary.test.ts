import { describe, expect, it } from "vitest";

import type { JobRow } from "../src/repositories/diagnostic-tables.js";
import {
  providersFromIntegrationConfig,
  providersFromJobSnapshot,
  skuNameFromDiagnosticSku,
  summarizeDiagnosticJobs,
} from "../src/services/diagnostic-job-summary.js";

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
    created_at: "2026-08-16T17:00:00.000Z",
    updated_at: "2026-08-16T17:01:00.000Z",
    started_at: "2026-08-16T17:00:01.000Z",
    completed_at: "2026-08-16T17:01:00.000Z",
    ...overrides,
  };
}

describe("skuNameFromDiagnosticSku", () => {
  it("prefers the Shopify snapshot name", () => {
    expect(
      skuNameFromDiagnosticSku({
        url: "https://acme.example/products/hero-sofa",
        shopify_data: { name: "Hero Sofa" },
      }),
    ).toBe("Hero Sofa");
  });

  it("falls back to the URL handle", () => {
    expect(
      skuNameFromDiagnosticSku({
        url: "https://acme.example/products/hero-sofa",
        shopify_data: { name: "  " },
      }),
    ).toBe("hero sofa");
  });
});

describe("summarizeDiagnosticJobs", () => {
  it("counts citations from queries and caps SKU names at 3", () => {
    const summaries = summarizeDiagnosticJobs(
      [job()],
      [
        { job_id: "job-1", url: "https://acme.example/products/a", shopify_data: { name: "A" } },
        { job_id: "job-1", url: "https://acme.example/products/b", shopify_data: { name: "B" } },
        { job_id: "job-1", url: "https://acme.example/products/c", shopify_data: { name: "C" } },
        { job_id: "job-1", url: "https://acme.example/products/d", shopify_data: { name: "D" } },
      ],
      [
        { job_id: "job-1", cliente_foi_citado: true },
        { job_id: "job-1", cliente_foi_citado: false },
        { job_id: "job-1", cliente_foi_citado: true },
      ],
      [{ job_id: "job-1", track: "track_llm", created_at: "2026-08-16T17:01:00.000Z" }],
    );

    expect(summaries).toEqual([
      {
        id: "job-1",
        status: "completed",
        probe_run_id: "run-1",
        created_at: "2026-08-16T17:00:00.000Z",
        completed_at: "2026-08-16T17:01:00.000Z",
        error_message: null,
        sku_names: ["A", "B", "C"],
        cited: 2,
        total: 3,
        track: "track_llm",
        providers: [],
      },
    ]);
  });

  it("reads stored providers and infers Shopify from Admin snapshots", () => {
    const [stored] = summarizeDiagnosticJobs(
      [
        job({
          config_snapshot: { providers: ["ga4", "shopify", "unknown"] },
        }),
      ],
      [],
      [],
      [],
    );
    expect(stored?.providers).toEqual(["shopify", "ga4"]);

    const [inferred] = summarizeDiagnosticJobs(
      [job({ id: "job-2", config_snapshot: {} })],
      [
        {
          job_id: "job-2",
          url: "https://acme.example/products/a",
          shopify_data: { name: "A", meta: { source: "shopify_api" } },
        },
      ],
      [],
      [],
    );
    expect(inferred?.providers).toEqual(["shopify"]);
  });

  it("keeps the latest track when a job has more than one diagnostic row", () => {
    const [summary] = summarizeDiagnosticJobs(
      [job()],
      [],
      [],
      [
        { job_id: "job-1", track: "track_pdp", created_at: "2026-08-16T17:00:00.000Z" },
        { job_id: "job-1", track: "track_llm", created_at: "2026-08-16T18:00:00.000Z" },
      ],
    );

    expect(summary?.track).toBe("track_llm");
    expect(summary?.cited).toBe(0);
    expect(summary?.total).toBe(0);
    expect(summary?.sku_names).toEqual([]);
    expect(summary?.providers).toEqual([]);
  });
});

describe("providersFromIntegrationConfig", () => {
  it("keeps Shopify, Meta, and GA4 in wizard order without secrets", () => {
    expect(
      providersFromIntegrationConfig({
        meta: { adAccountId: "act_1" },
        shopify: { shopDomain: "acme.myshopify.com" },
        ga4: { propertyId: "123" },
      }),
    ).toEqual(["shopify", "meta", "ga4"]);
    expect(providersFromIntegrationConfig({})).toEqual([]);
    expect(providersFromJobSnapshot({ providers: [] }, ["shopify_api"])).toEqual([]);
  });
});

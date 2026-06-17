import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { authHeaders } from "../src/lib/request.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

const TEST_API_KEY = "test-visibility-api-key";
const WORKSPACE_ID = "ws_probe_test";

function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "3010",
    VISIBILITY_API_KEY: TEST_API_KEY,
  });
}

async function seedStore(app: Awaited<ReturnType<typeof buildApp>>) {
  await app.inject({
    method: "PUT",
    url: `/v1/stores?workspace_id=${WORKSPACE_ID}`,
    headers: authHeaders(TEST_API_KEY),
    payload: { name: "Acme Shop", domain: "acme.example" },
  });

  await app.inject({
    method: "POST",
    url: `/v1/products?workspace_id=${WORKSPACE_ID}`,
    headers: authHeaders(TEST_API_KEY),
    payload: { url: "https://acme.example/products/hero", position: 1 },
  });

  const prompts = [
    "best running shoes for beginners",
    "affordable trainers under 500",
    "lightweight shoes for daily runs",
    "comfortable sneakers for jogging",
    "top rated running shoes 2026",
  ];

  for (let i = 0; i < prompts.length; i++) {
    await app.inject({
      method: "POST",
      url: `/v1/prompts?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { prompt_text: prompts[i], sort_order: i + 1 },
    });
  }
}

describe("Probe + score + results", () => {
  it("runs probe and returns latest score", async () => {
    const app = await buildApp(testConfig(), { repositories: createMemoryRepositories() });
    await seedStore(app);

    const run = await app.inject({
      method: "POST",
      url: `/v1/probes/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(run.statusCode).toBe(200);
    expect(run.json().citations_count).toBeGreaterThanOrEqual(0);
    expect(run.json().citation_slots_total).toBe(5);

    const score = await app.inject({
      method: "GET",
      url: `/v1/scores/latest?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(score.statusCode).toBe(200);
    expect(score.json().score.citations_count).toBe(run.json().citations_count);
    expect(Array.isArray(score.json().score.fixes)).toBe(true);
  });

  it("lists probe results with prompt text", async () => {
    const app = await buildApp(testConfig(), { repositories: createMemoryRepositories() });
    await seedStore(app);

    await app.inject({
      method: "POST",
      url: `/v1/probes/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    const list = await app.inject({
      method: "GET",
      url: `/v1/results?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().results.length).toBe(5);
    expect(list.json().results[0].prompt_text).toBeTruthy();
  });
});

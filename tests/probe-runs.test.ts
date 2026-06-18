import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { authHeaders } from "../src/lib/request.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

const TEST_API_KEY = "test-visibility-api-key";
const WORKSPACE_ID = "ws_probe_runs";

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

  for (let i = 0; i < 3; i++) {
    await app.inject({
      method: "POST",
      url: `/v1/prompts?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { prompt_text: `prompt ${i + 1}`, sort_order: i + 1 },
    });
  }
}

describe("Probe runs API", () => {
  it("lists runs, fetches run results, and compares two runs", async () => {
    const app = await buildApp(testConfig(), { repositories: createMemoryRepositories() });
    await seedStore(app);

    const first = await app.inject({
      method: "POST",
      url: `/v1/probes/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(first.statusCode).toBe(200);
    const firstRunId = first.json().probe_run_id as string;

    const second = await app.inject({
      method: "POST",
      url: `/v1/probes/run?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(second.statusCode).toBe(200);
    const secondRunId = second.json().probe_run_id as string;

    const list = await app.inject({
      method: "GET",
      url: `/v1/probe-runs?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().probe_runs.length).toBeGreaterThanOrEqual(2);

    const runResults = await app.inject({
      method: "GET",
      url: `/v1/probe-runs/${secondRunId}/results?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(runResults.statusCode).toBe(200);
    expect(runResults.json().results.length).toBe(3);
    expect(runResults.json().probe_run.citation_slots_total).toBe(3);

    const compare = await app.inject({
      method: "GET",
      url: `/v1/probe-runs/compare?workspace_id=${WORKSPACE_ID}&from=${firstRunId}&to=${secondRunId}`,
      headers: authHeaders(TEST_API_KEY),
    });
    expect(compare.statusCode).toBe(200);
    expect(compare.json().comparison.from_run_id).toBe(firstRunId);
    expect(compare.json().comparison.to_run_id).toBe(secondRunId);
  });
});

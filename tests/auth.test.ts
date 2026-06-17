import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { assertRuntimeConfig, loadConfig } from "../src/config.js";

const TEST_API_KEY = "test-visibility-api-key";

function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "3010",
    VISIBILITY_API_KEY: TEST_API_KEY,
    ...overrides,
  });
}

describe("Bearer auth on /v1", () => {
  it("allows GET /health without Authorization", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({ method: "GET", url: "/v1/status" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
  });

  it("returns 401 for wrong Bearer token", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
  });

  it("returns 401 when Bearer prefix is missing", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
      headers: { authorization: TEST_API_KEY },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 200 for valid Bearer token on GET /v1/status", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "rint-visibility",
      authenticated: true,
    });
  });

  it("returns 503 when VISIBILITY_API_KEY is not configured", async () => {
    const app = await buildApp(testConfig({ VISIBILITY_API_KEY: "" }));

    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
      headers: { authorization: "Bearer anything" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "Auth not configured",
      code: "AUTH_NOT_CONFIGURED",
    });
  });
});

describe("assertRuntimeConfig", () => {
  it("throws in production when VISIBILITY_API_KEY is missing", () => {
    expect(() =>
      assertRuntimeConfig(
        loadConfig({
          NODE_ENV: "production",
          VISIBILITY_API_KEY: "",
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role",
        }),
      ),
    ).toThrow(/VISIBILITY_API_KEY is required/);
  });

  it("throws in production when Supabase credentials are missing", () => {
    expect(() =>
      assertRuntimeConfig(
        loadConfig({
          NODE_ENV: "production",
          VISIBILITY_API_KEY: "secret",
          SUPABASE_URL: "",
          SUPABASE_SERVICE_ROLE_KEY: "",
        }),
      ),
    ).toThrow(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/);
  });

  it("allows missing credentials outside production", () => {
    expect(() =>
      assertRuntimeConfig(loadConfig({ NODE_ENV: "development", VISIBILITY_API_KEY: "" })),
    ).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { authHeaders } from "../src/lib/request.js";
import { createMemoryRepositories } from "./helpers/memory-repositories.js";

const TEST_API_KEY = "test-visibility-api-key";
const WORKSPACE_ID = "ws_test_123";

function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "3010",
    VISIBILITY_API_KEY: TEST_API_KEY,
    ...overrides,
  });
}

describe("CRUD /v1 stores, products, prompts", () => {
  it("returns 503 for CRUD routes when Supabase is not configured", async () => {
    const app = await buildApp(testConfig());

    const response = await app.inject({
      method: "GET",
      url: `/v1/stores?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "Supabase credentials are not configured",
      code: "SUPABASE_NOT_CONFIGURED",
    });
  });

  it("upserts and reads a store by workspace_id", async () => {
    const app = await buildApp(testConfig(), { repositories: createMemoryRepositories() });

    const upsert = await app.inject({
      method: "PUT",
      url: `/v1/stores?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { name: "Acme Shop", domain: "acme.example" },
    });

    expect(upsert.statusCode).toBe(200);
    expect(upsert.json().store).toMatchObject({
      workspace_id: WORKSPACE_ID,
      name: "Acme Shop",
      domain: "acme.example",
      status: "active",
    });

    const read = await app.inject({
      method: "GET",
      url: `/v1/stores?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(read.statusCode).toBe(200);
    expect(read.json().store.id).toBe(upsert.json().store.id);
  });

  it("manages products and prompts for a workspace store", async () => {
    const app = await buildApp(testConfig(), { repositories: createMemoryRepositories() });

    await app.inject({
      method: "PUT",
      url: `/v1/stores?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { name: "Acme Shop" },
    });

    const createProduct = await app.inject({
      method: "POST",
      url: `/v1/products?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: {
        url: "https://acme.example/products/hero",
        title: "Hero Tee",
        position: 1,
      },
    });

    expect(createProduct.statusCode).toBe(201);
    const productId = createProduct.json().product.id;

    const createPrompt = await app.inject({
      method: "POST",
      url: `/v1/prompts?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: {
        prompt_text: "best organic cotton t-shirt",
        sort_order: 1,
      },
    });

    expect(createPrompt.statusCode).toBe(201);
    const promptId = createPrompt.json().prompt.id;

    const listProducts = await app.inject({
      method: "GET",
      url: `/v1/products?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(listProducts.statusCode).toBe(200);
    expect(listProducts.json().products).toHaveLength(1);

    const patchProduct = await app.inject({
      method: "PATCH",
      url: `/v1/products/${productId}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { title: "Hero Tee Updated" },
    });

    expect(patchProduct.statusCode).toBe(200);
    expect(patchProduct.json().product.title).toBe("Hero Tee Updated");

    const patchPrompt = await app.inject({
      method: "PATCH",
      url: `/v1/prompts/${promptId}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
      payload: { active: false },
    });

    expect(patchPrompt.statusCode).toBe(200);
    expect(patchPrompt.json().prompt.active).toBe(false);

    const deletePrompt = await app.inject({
      method: "DELETE",
      url: `/v1/prompts/${promptId}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(deletePrompt.statusCode).toBe(204);

    const deleteProduct = await app.inject({
      method: "DELETE",
      url: `/v1/products/${productId}?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(deleteProduct.statusCode).toBe(204);
  });

  it("returns 404 when store does not exist for nested resources", async () => {
    const app = await buildApp(testConfig(), { repositories: createMemoryRepositories() });

    const response = await app.inject({
      method: "GET",
      url: `/v1/products?workspace_id=${WORKSPACE_ID}`,
      headers: authHeaders(TEST_API_KEY),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("NOT_FOUND");
  });
});

import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

describe("GET /health", () => {
  it("returns ok without external dependencies", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test", PORT: "3010" }));

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store, max-age=0");

    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("rint-visibility");
    expect(typeof body.timestamp).toBe("string");
  });
});

describe("loadConfig", () => {
  it("defaults port to 3010 when PORT is unset", () => {
    expect(loadConfig({ NODE_ENV: "test" }).port).toBe(3010);
  });

  it("reads PORT from environment", () => {
    expect(loadConfig({ NODE_ENV: "test", PORT: "4000" }).port).toBe(4000);
  });
});

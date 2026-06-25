import { describe, expect, it, vi } from "vitest";

import { createMetaCacPort } from "../src/ports/meta-cac-adapter.js";

describe("meta-cac-adapter", () => {
  it("aggregates spend and purchase conversions", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          {
            spend: "1350.00",
            actions: [
              { action_type: "purchase", value: "9" },
              { action_type: "link_click", value: "40" },
            ],
          },
        ],
      }),
    );

    const port = createMetaCacPort(
      {
        adAccountId: "act_123",
        accessToken: "token",
        graphApiVersion: "v21.0",
      },
      fetchImpl as typeof fetch,
    );

    const result = await port.getSkuCac("hero-ref", { start: "2026-05-01", end: "2026-05-31" });
    expect(result.spend).toBe(1350);
    expect(result.conversions).toBe(9);
    expect(result.cac).toBeCloseTo(150, 2);
    expect(result.meta.source).toBe("act_123");
  });
});

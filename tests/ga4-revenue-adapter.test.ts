import { describe, expect, it, vi } from "vitest";

import { createGa4AiReferralPort } from "../src/ports/ga4-revenue-adapter.js";

describe("ga4-revenue-adapter", () => {
  it("aggregates AI referral revenue by session source", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "fresh-access" });
      }
      return Response.json({
        rows: [
          {
            dimensionValues: [{ value: "chatgpt.com" }],
            metricValues: [{ value: "3000.50" }],
          },
          {
            dimensionValues: [{ value: "gemini.google.com" }],
            metricValues: [{ value: "1500.25" }],
          },
        ],
      });
    });

    const port = createGa4AiReferralPort(
      {
        propertyId: "123456",
        accessToken: "access",
        refreshToken: "refresh",
        clientId: "client",
        clientSecret: "secret",
      },
      fetchImpl as typeof fetch,
    );

    const result = await port.getAiReferralRevenue({ start: "2026-05-01", end: "2026-05-31" });

    expect(result.totalRevenue).toBeCloseTo(4500.75, 2);
    expect(result.bySource).toHaveLength(2);
    expect(result.meta.port).toBe("ga4");
    expect(result.meta.source).toBe("123456");
  });
});

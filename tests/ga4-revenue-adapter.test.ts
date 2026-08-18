import { describe, expect, it, vi } from "vitest";

import { createGa4AiReferralPort, GA4_AI_LANDING_LIMIT } from "../src/ports/ga4-revenue-adapter.js";

function reportDimensions(init: RequestInit | undefined): string[] {
  const parsed = JSON.parse(String(init?.body ?? "{}")) as {
    dimensions?: Array<{ name?: string }>;
  };
  return (parsed.dimensions ?? []).map((dimension) => dimension.name ?? "");
}

describe("ga4-revenue-adapter", () => {
  it("aggregates AI referral revenue by session source and top-K landings", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "fresh-access" });
      }
      if (reportDimensions(init).includes("landingPage")) {
        return Response.json({
          rows: [
            {
              dimensionValues: [{ value: "/" }],
              metricValues: [{ value: "35" }],
            },
            {
              dimensionValues: [{ value: "/products/daily-boost" }],
              metricValues: [{ value: "3" }],
            },
            {
              dimensionValues: [{ value: "/blog/compare" }],
              metricValues: [{ value: "1" }],
            },
          ],
        });
      }
      return Response.json({
        rows: [
          {
            dimensionValues: [{ value: "chatgpt.com" }, { value: "ai-assistant" }],
            metricValues: [{ value: "3000.50" }, { value: "44" }],
          },
          {
            dimensionValues: [{ value: "perplexity" }, { value: "(not set)" }],
            metricValues: [{ value: "0" }, { value: "1" }],
          },
          {
            dimensionValues: [{ value: "gemini.google.com" }, { value: "referral" }],
            metricValues: [{ value: "1500.25" }, { value: "0" }],
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
    expect(result.totalSessions).toBe(45);
    expect(result.bySource).toEqual([
      { source: "chatgpt.com", medium: "ai-assistant", revenue: 3000.5, sessions: 44 },
      { source: "perplexity", medium: "(not set)", revenue: 0, sessions: 1 },
      { source: "gemini.google.com", medium: "referral", revenue: 1500.25, sessions: 0 },
    ]);
    expect(result.landings).toEqual([
      { path: "/", sessions: 35 },
      { path: "/products/daily-boost", sessions: 3 },
      { path: "/blog/compare", sessions: 1 },
    ]);
    const sourceBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body ?? "{}")) as {
      metrics: Array<{ name: string }>;
      dimensionFilter: { orGroup: unknown };
    };
    expect(sourceBody.metrics.map((metric) => metric.name)).toEqual([
      "purchaseRevenue",
      "sessions",
    ]);
    expect(sourceBody.dimensionFilter.orGroup).toBeTruthy();
    const landingBody = JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body ?? "{}")) as {
      dimensions: Array<{ name: string }>;
      metrics: Array<{ name: string }>;
      limit: number;
    };
    expect(landingBody.dimensions.map((dimension) => dimension.name)).toEqual(["landingPage"]);
    expect(landingBody.metrics.map((metric) => metric.name)).toEqual(["sessions"]);
    expect(landingBody.limit).toBe(GA4_AI_LANDING_LIMIT);
    expect(result.meta.port).toBe("ga4");
    expect(result.meta.source).toBe("123456");
  });

  it("keeps sessions when the landing report fails", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (reportDimensions(init).includes("landingPage")) {
        return Response.json({ error: { message: "landing_denied" } }, { status: 403 });
      }
      return Response.json({
        rows: [
          {
            dimensionValues: [{ value: "chatgpt.com" }, { value: "referral" }],
            metricValues: [{ value: "100" }, { value: "12" }],
          },
        ],
      });
    });

    const port = createGa4AiReferralPort(
      { propertyId: "123456", accessToken: "access" },
      fetchImpl as typeof fetch,
    );
    const result = await port.getAiReferralRevenue({ start: "2026-05-01", end: "2026-05-31" });
    expect(result.totalSessions).toBe(12);
    expect(result.landings).toBeUndefined();
  });
});

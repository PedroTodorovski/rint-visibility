import { describe, expect, it } from "vitest";
import { selectSearchConsoleUrl } from "../src/services/search-console-url-matcher.js";

const surfaceConfig = {
  clientDomain: "nuture.com.br",
  storefrontHosts: ["nuture.com.br"],
  ownedContentHosts: ["blog.nuture.com.br"],
  ownedContentPaths: ["/blog", "/pages", "/guias"],
  searchConsoleProperties: [{ type: "domain" as const, domain: "nuture.com.br" }],
};

describe("selectSearchConsoleUrl", () => {
  it("chooses the owned content URL with the strongest theme and opportunity signal", () => {
    const match = selectSearchConsoleUrl({
      theme: "vitamina d3 k2 gotas",
      surfaceConfig,
      candidates: [
        {
          url: "https://nuture.com.br/blog/omega-3",
          property: "sc-domain:nuture.com.br",
          clicks: 80,
          impressions: 3000,
          ctr: 0.026,
          position: 9.1,
          topQuery: "omega 3 infantil",
        },
        {
          url: "https://nuture.com.br/guias/vitamina-d3-k2-gotas",
          property: "sc-domain:nuture.com.br",
          clicks: 74,
          impressions: 2310,
          ctr: 0.032,
          position: 11.2,
          topQuery: "vitamina d3 k2 gotas",
          queries: [
            {
              query: "vitamina d3 k2 gotas",
              clicks: 74,
              impressions: 2310,
              ctr: 0.032,
              position: 11.2,
            },
          ],
        },
      ],
    });

    expect(match?.candidate.url).toBe("https://nuture.com.br/guias/vitamina-d3-k2-gotas");
    expect(match?.confidence).toBe("high");
    expect(match?.matched_queries).toContain("vitamina d3 k2 gotas");
    expect(match?.metrics.position).toBe(11.2);
  });

  it("does not recommend PDPs or external sources as owned editorial content", () => {
    const match = selectSearchConsoleUrl({
      theme: "vitamina d3 k2 gotas",
      surfaceConfig,
      candidates: [
        {
          url: "https://nuture.com.br/products/vitamina-d3-k2",
          property: "sc-domain:nuture.com.br",
          clicks: 200,
          impressions: 5000,
          topQuery: "vitamina d3 k2 gotas",
        },
        {
          url: "https://reviewexterno.com.br/vitamina-d3-k2",
          property: "sc-domain:nuture.com.br",
          clicks: 200,
          impressions: 5000,
          topQuery: "vitamina d3 k2 gotas",
        },
      ],
    });

    expect(match).toBeNull();
  });

  it("accepts owned content subdomains when covered by a domain property", () => {
    const match = selectSearchConsoleUrl({
      theme: "vitamina d3 k2 gotas",
      surfaceConfig,
      candidates: [
        {
          url: "https://blog.nuture.com.br/vitamina-d3-k2-gotas",
          property: "sc-domain:nuture.com.br",
          clicks: 32,
          impressions: 1200,
          ctr: 0.026,
          position: 12.4,
          topQuery: "vitamina d3 k2 gotas",
        },
      ],
    });

    expect(match?.candidate.url).toBe("https://blog.nuture.com.br/vitamina-d3-k2-gotas");
    expect(match?.surface.kind).toBe("owned_content_subdomain");
    expect(match?.surface.search_console_coverage).toBe("covered");
  });

  it("falls back to creating a new URL when the candidate does not match the theme", () => {
    const match = selectSearchConsoleUrl({
      theme: "suplemento de greens",
      surfaceConfig,
      candidates: [
        {
          url: "https://nuture.com.br/blog/magnesio",
          property: "sc-domain:nuture.com.br",
          clicks: 5,
          impressions: 80,
          topQuery: "magnesio dimalato",
        },
      ],
    });

    expect(match).toBeNull();
  });

  it("does not let high Search Console volume override weak lexical relevance", () => {
    const match = selectSearchConsoleUrl({
      theme: "vitamina d3 k2 gotas",
      surfaceConfig,
      candidates: [
        {
          url: "https://nuture.com.br/blog/vitamina-c",
          property: "sc-domain:nuture.com.br",
          clicks: 6000,
          impressions: 180000,
          ctr: 0.033,
          position: 6.2,
          topQuery: "vitamina c",
        },
      ],
    });

    expect(match).toBeNull();
  });
});

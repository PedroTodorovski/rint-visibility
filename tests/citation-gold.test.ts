import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  brandMentionedWithoutBuyLink,
  classifyBrandSurface,
  clientHostsFromIdentity,
  planClientSiteFollowUp,
  scoreClientCitation,
} from "../src/lib/citation-gold.js";

const IDENTITY = {
  storeName: "Nuture",
  domain: "nuture.com.br",
  productUrl: "https://nuture.com.br/products/nuture-daily-boost",
  productName: "Nuture Daily Boost",
};

describe("scoreClientCitation", () => {
  it("does not treat a negative mention as a client citation", () => {
    const evidence = scoreClientCitation({
      text: 'É importante notar que o produto "Nuture Daily Boost" da Nuture não foi encontrado nas buscas por greens no Brasil.',
      identity: IDENTITY,
      resolved: [
        {
          from: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
          to: "https://www.decathlon.com.br/snowboard",
          host: "decathlon.com.br",
        },
      ],
      llmClaimedCited: true,
    });
    expect(evidence.cited).toBe(false);
    expect(evidence.why).toBe("negative_mention");
    expect(evidence.negative_mention).toBe(true);
    expect(evidence.llm_claimed_cited).toBe(true);
  });

  it("ignores prompt echo in the answer unless the client host is in resolved grounding", () => {
    const evidence = scoreClientCitation({
      text: "Você pode encontrar o **Nuture Daily Boost** na loja online nuture.com.br.",
      identity: IDENTITY,
      resolved: [
        {
          from: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
          to: "https://www.decathlon.com.br/prancha",
          host: "decathlon.com.br",
        },
      ],
      llmClaimedCited: true,
    });
    expect(evidence.cited).toBe(false);
    expect(evidence.why).toBe("text_only_not_grounded");
  });

  it("cites only when a resolved grounding host is the client store", () => {
    const evidence = scoreClientCitation({
      text: "The Nuture Daily Boost is available at nuture.com.br.",
      identity: IDENTITY,
      resolved: [
        {
          from: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
          to: "https://nuture.com.br/products/nuture-daily-boost",
          host: "nuture.com.br",
        },
      ],
      llmClaimedCited: false,
    });
    expect(evidence.cited).toBe(true);
    expect(evidence.why).toBe("grounding_host");
    expect(evidence.llm_claimed_cited).toBe(false);
  });

  it("never treats *.myshopify.com as the shopper storefront", () => {
    expect(
      clientHostsFromIdentity({
        storeName: "Nuture",
        domain: "nuture-loja.myshopify.com",
        productUrl: "https://nuture.com.br/products/nuture-daily-boost",
        productName: "Nuture Daily Boost",
      }),
    ).toEqual(["nuture.com.br"]);
    expect(
      clientHostsFromIdentity({
        storeName: "Rint Test Store",
        domain: "rint-test-store.myshopify.com",
        productUrl: "https://rint-test-store.myshopify.com/products/the-multi-location-snowboard",
        productName: "The Multi-location Snowboard",
      }),
    ).toEqual([]);
  });
});

describe("classifyBrandSurface", () => {
  const config = {
    storefrontHosts: ["nuture.com.br"],
    productUrls: ["https://nuture.com.br/products/nuture-daily-boost"],
    ownedContentHosts: ["conteudo.nuture.com.br"],
    searchConsoleProperties: [{ type: "domain" as const, domain: "nuture.com.br" }],
  };

  it("separates storefront, owned content directory, owned content subdomain, and external sources", () => {
    expect(
      classifyBrandSurface("https://nuture.com.br/products/nuture-daily-boost", config),
    ).toMatchObject({
      kind: "owned_storefront",
      host: "nuture.com.br",
      search_console_coverage: "covered",
    });
    expect(classifyBrandSurface("https://nuture.com.br/blog/greens-em-po", config)).toMatchObject({
      kind: "owned_content_directory",
      host: "nuture.com.br",
      search_console_coverage: "covered",
    });
    expect(classifyBrandSurface("https://blog.nuture.com.br/greens-em-po", config)).toMatchObject({
      kind: "owned_content_subdomain",
      host: "blog.nuture.com.br",
      search_console_coverage: "covered",
    });
    expect(classifyBrandSurface("https://healthline.com/ag1-review", config)).toMatchObject({
      kind: "external_source",
      host: "healthline.com",
      search_console_coverage: "not_covered",
    });
  });

  it("does not assume URL-prefix Search Console properties cover subdomains", () => {
    const urlPrefixConfig = {
      ...config,
      searchConsoleProperties: [{ type: "url_prefix" as const, url: "https://nuture.com.br/" }],
    };

    expect(
      classifyBrandSurface("https://nuture.com.br/blog/greens-em-po", urlPrefixConfig),
    ).toMatchObject({
      kind: "owned_content_directory",
      search_console_coverage: "covered",
    });
    expect(
      classifyBrandSurface("https://blog.nuture.com.br/greens-em-po", urlPrefixConfig),
    ).toMatchObject({
      kind: "external_source",
      search_console_coverage: "not_covered",
    });
  });

  it("keeps recommendations useful when Search Console is absent", () => {
    expect(
      classifyBrandSurface("https://nuture.com.br/blog/greens-em-po", {
        storefrontHosts: ["nuture.com.br"],
      }),
    ).toMatchObject({
      kind: "owned_content_directory",
      search_console_coverage: "unknown",
    });
    expect(
      classifyBrandSurface("https://blog.nuture.com.br/greens-em-po", {
        storefrontHosts: ["nuture.com.br"],
      }),
    ).toMatchObject({
      kind: "external_source",
      search_console_coverage: "unknown",
    });
  });
});

describe("brandMentionedWithoutBuyLink", () => {
  const nuture = {
    storeName: "Nuture",
    domain: "nuture.com.br",
    productUrl: "https://nuture.com.br/products/nuture-daily-boost",
  };

  it("asks when the brand is named and the store link is missing", () => {
    expect(
      brandMentionedWithoutBuyLink({
        text: "O Nuture Daily Boost é uma alternativa nacional ao AG1.",
        ...nuture,
        resolved: [
          { from: "https://drinkag1.com", to: "https://drinkag1.com", host: "drinkag1.com" },
        ],
      }),
    ).toBe(true);
  });

  it("does not ask when the answer already has the store host", () => {
    expect(
      brandMentionedWithoutBuyLink({
        text: "O Nuture Daily Boost está em nuture.com.br.",
        ...nuture,
        resolved: [],
      }),
    ).toBe(false);
  });

  it("does not ask when grounding already has the store", () => {
    expect(
      brandMentionedWithoutBuyLink({
        text: "O Nuture Daily Boost aparece nas buscas.",
        ...nuture,
        resolved: [
          {
            from: "https://nuture.com.br/products/nuture-daily-boost",
            to: "https://nuture.com.br/products/nuture-daily-boost",
            host: "nuture.com.br",
          },
        ],
      }),
    ).toBe(false);
  });

  it("still asks when grounding only has a brand blog or help host", () => {
    expect(
      brandMentionedWithoutBuyLink({
        text: "O Nuture Daily Boost é a alternativa nacional ao AG1.",
        ...nuture,
        resolved: [
          {
            from: "https://v5.nuture.com.br/blog/athletic-greens-ag1-brasil-alternativa/",
            to: "https://v5.nuture.com.br/blog/athletic-greens-ag1-brasil-alternativa/",
            host: "v5.nuture.com.br",
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not treat a generic D3 answer or Natus Green as Nuture", () => {
    expect(
      brandMentionedWithoutBuyLink({
        text: "Puravida e Vitafor aparecem nas gotas de vitamina D3 K2.",
        storeName: "Nuture",
        domain: "nuture.com.br",
        productUrl: "https://nuture.com.br/products/vitamina-d3k2-daily-boost",
        resolved: [],
      }),
    ).toBe(false);
    expect(
      brandMentionedWithoutBuyLink({
        text: "Natus Green vende CoQ10 na Drogasil.",
        ...nuture,
        resolved: [],
      }),
    ).toBe(false);
  });

  it("writes a shopper follow-up without leaking the store URL", () => {
    const plan = planClientSiteFollowUp("Nuture", "Nuture Daily Boost");
    expect(plan.query).toMatch(/Nuture/);
    expect(plan.query).toMatch(/site|link/i);
    expect(plan.query).not.toMatch(/nuture\.com\.br/i);
  });
});

describe("diagnostic shopper prompt", () => {
  it("does not put the client store in the first Gemini pass", () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/llm/gemini.ts"),
      "utf-8",
    );
    expect(src).toContain("Shopper query:");
    expect(src).toContain("Do not invent a store");
    expect(src).not.toContain("Client PDP:");
    expect(src).not.toContain("Client product:");
    expect(src).not.toContain("Client brand/store:");
  });
});

import { describe, expect, it } from "vitest";

import { detectCitation } from "../src/lib/citation.js";

describe("detectCitation", () => {
  const ctx = {
    storeName: "CorridaBR",
    domain: "corridabr.com.br",
    productUrls: ["https://corridabr.com.br/tenis-iniciante"],
  };

  it("detects domain URL in response", () => {
    const result = detectCitation(
      "Try CorridaBR at https://corridabr.com.br/tenis-iniciante for beginners.",
      ctx,
    );
    expect(result.cited).toBe(true);
    expect(result.matchSignals.some((s) => s === "url_match" || s === "domain_match")).toBe(true);
  });

  it("detects brand name when no URL", () => {
    const result = detectCitation("CorridaBR has good options for running shoes.", ctx);
    expect(result.cited).toBe(true);
    expect(result.matchSignals).toContain("brand_match");
  });

  it("returns not cited for generic response with competitors", () => {
    const result = detectCitation("Nike and Adidas are popular brands.", ctx);
    expect(result.cited).toBe(false);
    expect(result.whyCode).toBe("uncited_competitor");
    expect(result.competitors.length).toBeGreaterThan(0);
  });

  it("classifies domain citation for Inflow", () => {
    const inflow = {
      storeName: "Inflow Sofá",
      domain: "inflowsofa.com.br",
      productUrls: ["https://inflowsofa.com.br/products/sofa-cama-flowin"],
      promptText: "Sofá modular bege bouclé — onde comprar no Brasil",
    };
    const result = detectCitation(
      "Veja opções em https://inflowsofa.com.br/ com entrega nacional.",
      inflow,
    );
    expect(result.cited).toBe(true);
    expect(result.whyCode).toBe("cited_domain");
    expect(result.citationLayer).toBe("domain");
    expect(result.highlightSpans.length).toBeGreaterThan(0);
  });

  it("flags generic prompt mismatch when store not in prompt", () => {
    const inflow = {
      storeName: "Inflow Sofá",
      domain: "inflowsofa.com.br",
      productUrls: [],
      promptText: "Sofá em caixa pela internet",
    };
    const result = detectCitation(
      "Marcas como Sofá na Caixa lideram esse segmento.",
      inflow,
    );
    expect(result.cited).toBe(false);
    expect(result.whyCode).toBe("uncited_competitor");
  });

  it("detects accented brand names", () => {
    const inflow = {
      storeName: "Inflow Sofá",
      domain: "inflowsofa.com.br",
      productUrls: ["https://inflowsofa.com.br/products/sofa-cama-flowin"],
    };
    const result = detectCitation("# Inflow Sofá - Análise\n\nA Inflow é considerada boa.", inflow);
    expect(result.cited).toBe(true);
    expect(result.matchSignals).toContain("brand_match");
  });

  it("detects primary brand token when full name is abbreviated", () => {
    const inflow = {
      storeName: "Inflow Sofá",
      domain: "inflowsofa.com.br",
      productUrls: [],
    };
    const result = detectCitation("A Inflow tem boa reputação no segmento.", inflow);
    expect(result.cited).toBe(true);
    expect(result.matchSignals).toContain("brand_token_match");
  });

  it("anchors excerpt on brand sentence, not search preamble", () => {
    const inflow = {
      storeName: "Inflow Sofá",
      domain: "inflowsofa.com.br",
      productUrls: ["https://inflowsofa.com.br/products/sofa-cama-flowin"],
      promptText: "Sofá modular bege bouclé — onde comprar no Brasil",
    };
    const result = detectCitation(
      `I'll search for current information about where to buy beige boucle modular sofas in Brazil.

Para sofás modulares em bege bouclé, você tem excelentes opções em https://inflowsofa.com.br com entrega nacional.`,
      inflow,
    );
    expect(result.cited).toBe(true);
    expect(result.excerpt).not.toMatch(/^I'll search/i);
    expect(result.excerpt).toMatch(/inflowsofa\.com\.br/i);
    expect(result.highlightSpans.length).toBeGreaterThan(0);
  });

  it("ends excerpt on full sentence when brand is cited", () => {
    const inflow = {
      storeName: "Inflow Sofá",
      domain: "inflowsofa.com.br",
      productUrls: [],
      promptText: "Inflow Sofá é boa marca?",
    };
    const result = detectCitation(
      "Sim, a Inflow é uma marca promissora para quem busca sofás modernos com entrega rápida. A marca tem o objetivo de simplificar e transformar o processo de compra.",
      inflow,
    );
    expect(result.cited).toBe(true);
    expect(result.excerpt).toMatch(/Inflow/i);
    expect(result.excerpt).not.toMatch(/compr$/);
    expect(result.excerpt).toMatch(/compra\.?/);
    expect(result.highlightSpans.some((s) => result.excerpt.slice(s.start, s.end).toLowerCase().includes("inflow"))).toBe(
      true,
    );
  });
});

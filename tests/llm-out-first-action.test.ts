import { describe, expect, it } from "vitest";

import {
  catalogFoundationFromFields,
  formulateTrackLlmFirstAction,
  themeFromQuerySet,
} from "../src/services/llm-out-first-action.js";

const DAILY_QUERIES = [
  "Melhor suplemento de greens no Brasil",
  "Alternativa ao AG1 com vitaminas e minerais",
  "suplemento greens em pó com CoQ10",
  "Nuture Daily Boost vale a pena",
  "Nuture Daily Boost vs AG1",
];

const D3_QUERIES = [
  "Vitamina D3 K2 em gotas com boa avaliação",
  "melhor vitamina D3 K2 no Brasil",
  "vitamina D3 2000 UI K2 MK-7 gotas",
  "Nuture vitamina D3 K2",
  "Nuture D3K2 gotas nuture.com.br",
];

describe("formulateTrackLlmFirstAction", () => {
  it("formulates Daily Boost from the five-query set, never pasting query[0]", () => {
    const brief = formulateTrackLlmFirstAction({
      skuName: "Nuture Daily Boost",
      brand: "Nuture",
      queryTexts: DAILY_QUERIES,
      unusedOwnAttrs: ["59 vitaminas, minerais, bioativos e vegetais", "2 scoops (10 g) ao dia"],
      skipAttrs: ["75 vitaminas e minerais", "Certificação NSF", "1 scoop por dia"],
      readReviewOrRivalStore: true,
    });

    expect(brief.theme).toBe("suplemento de greens no Brasil, como alternativa ao que a IA citou");
    expect(foldEqualsAnyQuery(brief.theme, DAILY_QUERIES)).toBe(false);
    expect(brief.page_type).toBe("landing_editorial_comparativa");
    expect(brief.surface).toBe("nova_landing_editorial_no_dominio_nao_pdp");
    expect(brief.target_url).toBeNull();
    expect(brief.first_action).not.toContain("Melhor suplemento de greens no Brasil");
    expect(brief.first_action).not.toContain("Escreva no seu site um texto");
    expect(brief.first_action).toContain("landing editorial/comparativa");
    expect(brief.first_action).toContain("URL própria");
    expect(brief.first_action).toContain("fora da PDP");
    expect(brief.first_action).toContain("link para Nuture Daily Boost");
    expect(brief.first_action).toContain("59 vitaminas");
    expect(brief.first_action).toContain("2 scoops");
    expect(brief.first_action).toContain("Certificação NSF");
    expect(brief.first_action).toContain("review");
    expect(brief.grounding_note).toBe("review_not_listing");
  });

  it("formulates D3 from the five-query set, never pasting a wizard query", () => {
    const brief = formulateTrackLlmFirstAction({
      skuName: "Vitamina D3K2",
      brand: "Nuture",
      queryTexts: D3_QUERIES,
      unusedOwnAttrs: ["2.000 UI de D3", "65 mcg K2 MK-7"],
      skipAttrs: ["200 mcg de K2", "Selo vegan"],
      readReviewOrRivalStore: true,
    });

    expect(brief.theme).toBe("Vitamina D3 K2 em gotas no Brasil");
    expect(foldEqualsAnyQuery(brief.theme, D3_QUERIES)).toBe(false);
    expect(brief.first_action).not.toContain("Vitamina D3 K2 em gotas com boa avaliação");
    expect(brief.first_action).toContain("landing editorial/comparativa");
    expect(brief.first_action).toContain("link para Vitamina D3K2");
    expect(brief.first_action).toContain("2.000 UI de D3");
    expect(brief.first_action).toContain("Selo vegan");
  });

  it("chooses to improve an existing owned content URL when Gemini already read it", () => {
    const brief = formulateTrackLlmFirstAction({
      skuName: "Nuture Daily Boost",
      brand: "Nuture",
      queryTexts: DAILY_QUERIES,
      unusedOwnAttrs: ["59 vitaminas, minerais, bioativos e vegetais"],
      skipAttrs: [],
      readReviewOrRivalStore: false,
      existingContentUrl: "https://nuture.com.br/blog/greens-em-po",
      existingContentSurface: "owned_content_directory",
      searchConsoleCoverage: "covered",
      targetUrlSource: "search_console",
    });

    expect(brief.surface).toBe("url_editorial_existente_no_dominio_nao_pdp");
    expect(brief.target_url).toBe("https://nuture.com.br/blog/greens-em-po");
    expect(brief.target_url_source).toBe("search_console");
    expect(brief.existing_content_surface).toBe("owned_content_directory");
    expect(brief.search_console_coverage).toBe("covered");
    expect(brief.first_action).toContain("Melhore esta landing editorial/comparativa");
    expect(brief.first_action).toContain("https://nuture.com.br/blog/greens-em-po");
    expect(brief.first_action).toContain("Reforce o link para Nuture Daily Boost");
  });

  it("falls back to the SKU name when the set has no shared product phrase", () => {
    const theme = themeFromQuerySet(["vale a pena", "comparar preços"], "Hero Sofa", "Acme");
    expect(theme).toBe("Hero Sofa");
  });

  it("leads with Shopify cadastro when description or attributes are missing", () => {
    const brief = formulateTrackLlmFirstAction({
      skuName: "Nuture Daily Boost",
      brand: "Nuture",
      queryTexts: DAILY_QUERIES,
      unusedOwnAttrs: ["Sabor refrescante"],
      skipAttrs: ["Certificação NSF"],
      readReviewOrRivalStore: true,
      existingContentUrl: "https://nuture.com.br/blog/greens-em-po",
      existingContentSurface: "owned_content_directory",
      searchConsoleCoverage: "covered",
      targetUrlSource: "search_console",
      catalogGaps: ["attributes", "description"],
      productUrl: "https://nuture.com.br/products/nuture-daily-boost",
    });

    expect(brief.catalog_first).toBe(true);
    expect(brief.surface).toBe("cadastro_shopify_antes_da_landing");
    expect(brief.target_url).toBe("https://nuture.com.br/products/nuture-daily-boost");
    expect(brief.target_url_source).toBeNull();
    expect(brief.use_attrs).toEqual([]);
    expect(brief.first_action).toContain("Complete no Shopify");
    expect(brief.first_action).toContain("descrição e os atributos técnicos");
    expect(brief.first_action).toContain("cadastro é a base");
    expect(brief.first_action).not.toContain("Melhore esta landing editorial/comparativa");
    expect(brief.first_action).toContain("Com o cadastro em ordem");
    expect(brief.first_action).toContain("melhore o guia");
    expect(brief.first_action).not.toContain("nesta página");
  });

  it("does not start at Shopify when the cited object is incoherent, even if the catalog is thin", () => {
    const brief = formulateTrackLlmFirstAction({
      skuName: "Nuture Daily Boost",
      brand: "Nuture",
      queryTexts: DAILY_QUERIES,
      unusedOwnAttrs: ["Sabor refrescante"],
      skipAttrs: ["Certificação NSF"],
      readReviewOrRivalStore: true,
      existingContentUrl: "https://nuture.com.br/blog/greens-em-po",
      existingContentSurface: "owned_content_directory",
      catalogGaps: ["attributes", "description"],
      productUrl: "https://nuture.com.br/products/nuture-daily-boost",
      incoherent: true,
    });

    expect(brief.catalog_first).toBe(false);
    expect(brief.incoherent).toBe(true);
    expect(brief.first_action).not.toContain("Complete no Shopify");
    expect(brief.first_action).toContain("https://nuture.com.br/blog/greens-em-po");
  });
});

describe("catalogFoundationFromFields", () => {
  it("ignores an unread description length", () => {
    expect(catalogFoundationFromFields({ attributes: ["a", "b", "c"] })).toEqual([]);
    expect(
      catalogFoundationFromFields({ attributes: ["Greens"], descriptionChars: 24 }),
    ).toEqual(["attributes", "description"]);
  });
});

function foldEqualsAnyQuery(theme: string, queries: string[]): boolean {
  const fold = theme
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return queries.some(
    (query) =>
      query
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim() === fold,
  );
}

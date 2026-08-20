import { describe, expect, it } from "vitest";
import {
  buildDeterministicFounderActionCopy,
  renderFounderActionWithGuardrails,
  type TrackLlmContentBriefForCopy,
  validateFounderActionCopy,
} from "../src/services/founder-action-copy.js";

const brief: TrackLlmContentBriefForCopy = {
  theme: "suplemento de greens no Brasil",
  sku_name: "Nuture Daily Boost",
  target_url: "https://nuture.com.br/blog/greens-em-po",
  target_url_source: "search_console",
  use_attrs: ["59 vitaminas, minerais, bioativos e vegetais", "2 scoops (10 g) ao dia"],
  skip_attrs: ["Certificação NSF"],
  grounding_note: "review_not_listing",
};

describe("founder-action-copy", () => {
  it("builds a friendly deterministic fallback from the locked brief", () => {
    const copy = buildDeterministicFounderActionCopy(brief);

    expect(copy).toContain("Melhore esta página do seu site");
    expect(copy).toContain("https://nuture.com.br/blog/greens-em-po");
    expect(copy).toContain("59 vitaminas");
    expect(copy).toContain("Não afirme Certificação NSF");
  });

  it("leads with the mismatch when the cited object is incoherent", () => {
    const copy = buildDeterministicFounderActionCopy({
      ...brief,
      incoherent: true,
    });

    expect(copy).toContain("já fala de Nuture Daily Boost");
    expect(copy).toContain("não batem com a loja");
    expect(copy).toContain("https://nuture.com.br/blog/greens-em-po");
  });

  it("leads with named-without-store when grounding skipped the shopfront", () => {
    const copy = buildDeterministicFounderActionCopy({
      ...brief,
      sourcesWithoutStore: true,
    });

    expect(copy).toContain("já fala do nome de Nuture Daily Boost");
    expect(copy).toContain("outros sites");
    expect(copy).toContain("https://nuture.com.br/blog/greens-em-po");
    expect(copy).not.toContain("não batem com a loja");
  });

  it("rejects copy that invents a URL", () => {
    const reason = validateFounderActionCopy(
      "Melhore esta página do seu site: https://nuture.com.br/blog/greens-em-po. Use estes fatos reais que já estão no cadastro: 59 vitaminas, minerais, bioativos e vegetais e 2 scoops (10 g) ao dia. Veja também https://outra-url.com. Reforce nela o caminho para Nuture Daily Boost. Não afirme Certificação NSF.",
      brief,
    );

    expect(reason).toBe("invented_url");
  });

  it("rejects forbidden attributes used as positive claims", () => {
    const reason = validateFounderActionCopy(
      "Melhore esta página do seu site: https://nuture.com.br/blog/greens-em-po. Use estes fatos reais que já estão no cadastro: 59 vitaminas, minerais, bioativos e vegetais e 2 scoops (10 g) ao dia. Reforce nela o caminho para Nuture Daily Boost. Mostre a Certificação NSF com destaque.",
      brief,
    );

    expect(reason).toBe("forbidden_attr_as_positive");
  });

  it("falls back when the cheap copywriter is not configured", async () => {
    const result = await renderFounderActionWithGuardrails({
      deterministicAction: "Melhore esta landing editorial/comparativa já existente.",
      brief,
      llm: null,
    });

    expect(result.copy_source).toBe("deterministic_friendly");
    expect(result.copy_fallback_reason).toBe("copywriter_not_configured");
    expect(result.first_action).toContain("Melhore esta página do seu site");
  });

  it("does not mark mocked copywriter output as llm copy", async () => {
    const result = await renderFounderActionWithGuardrails({
      deterministicAction: "Melhore esta landing editorial/comparativa já existente.",
      brief,
      llm: {
        probe: async () => ({ text: "", model: "mock", mocked: true }),
        probeBatch: async () => ({ responses: [], model: "mock", mocked: true }),
        renderFounderAction: async () => ({
          text: buildDeterministicFounderActionCopy(brief),
          model: "mock",
          mocked: true,
        }),
      },
    });

    expect(result.copy_source).toBe("deterministic_friendly");
    expect(result.copy_fallback_reason).toBe("copywriter_mocked");
  });

  it("leads with cadastro and does not treat the PDP URL as an already-found editorial page", () => {
    const catalogBrief: TrackLlmContentBriefForCopy = {
      theme: "suplemento de greens no Brasil",
      sku_name: "Nuture Daily Boost",
      target_url: "https://nuture.com.br/products/nuture-daily-boost",
      catalog_first: true,
      catalog_gaps: ["attributes", "description"],
      skip_attrs: ["Certificação NSF"],
      grounding_note: "review_not_listing",
    };
    const copy = buildDeterministicFounderActionCopy(catalogBrief);

    expect(copy).toContain("Complete no Shopify");
    expect(copy).toContain("cadastro é a base");
    expect(copy).not.toContain("Melhore esta página do seu site");
    expect(copy).toContain("crie uma página");
    expect(copy).not.toContain("nesta página");
    expect(validateFounderActionCopy(copy, catalogBrief)).toBeNull();
    expect(
      validateFounderActionCopy(
        "Crie um blog sobre greens para o Nuture Daily Boost nesta página: https://nuture.com.br/products/nuture-daily-boost.",
        catalogBrief,
      ),
    ).toBe("missing_catalog_first");
  });

  it("rejects generic copy when the brief is incoherent or named-without-store", () => {
    const generic =
      "Melhore esta página do seu site: https://nuture.com.br/blog/greens-em-po. Use estes fatos reais que já estão no cadastro: 59 vitaminas, minerais, bioativos e vegetais e 2 scoops (10 g) ao dia. Reforce nela o caminho para Nuture Daily Boost. Não afirme Certificação NSF.";

    expect(validateFounderActionCopy(generic, { ...brief, incoherent: true })).toBe(
      "missing_incoherent",
    );
    expect(validateFounderActionCopy(generic, { ...brief, sourcesWithoutStore: true })).toBe(
      "missing_sources_without_store",
    );
    expect(
      validateFounderActionCopy(buildDeterministicFounderActionCopy({ ...brief, incoherent: true }), {
        ...brief,
        incoherent: true,
      }),
    ).toBeNull();
    expect(
      validateFounderActionCopy(
        buildDeterministicFounderActionCopy({ ...brief, sourcesWithoutStore: true }),
        { ...brief, sourcesWithoutStore: true },
      ),
    ).toBeNull();
  });
});

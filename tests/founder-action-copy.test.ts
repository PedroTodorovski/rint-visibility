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
  it("builds a short deterministic fallback without dumping URL or attrs", () => {
    const copy = buildDeterministicFounderActionCopy(brief);

    expect(copy).toContain("Melhore esta página");
    expect(copy).toContain("suplemento de greens no Brasil");
    expect(copy).not.toContain("https://nuture.com.br/blog/greens-em-po");
    expect(copy).not.toContain("59 vitaminas");
    expect(copy).not.toContain("Não afirme Certificação NSF");
    expect(validateFounderActionCopy(copy, brief)).toBeNull();
  });

  it("leads with the mismatch when the cited object is incoherent", () => {
    const copy = buildDeterministicFounderActionCopy({
      ...brief,
      incoherent: true,
      week_reason: "incoherent",
    });

    expect(copy).toContain("já fala de você");
    expect(copy).toContain("não batem com a loja");
    expect(copy).not.toContain("https://");
    expect(
      validateFounderActionCopy(copy, { ...brief, incoherent: true, week_reason: "incoherent" }),
    ).toBeNull();
  });

  it("leads with named-without-store when grounding skipped the shopfront", () => {
    const copy = buildDeterministicFounderActionCopy({
      ...brief,
      sourcesWithoutStore: true,
      week_reason: "sources_without_store",
    });

    expect(copy).toContain("já fala o nome");
    expect(copy).toContain("outros sites");
    expect(copy).not.toContain("não batem com a loja");
  });

  it("writes a category page when the week reason is a category miss", () => {
    const copy = buildDeterministicFounderActionCopy({
      ...brief,
      week_reason: "category_partial",
    });

    expect(copy).toMatch(/sem saber o nome da loja/);
    expect(copy).not.toContain("não batem");
    expect(copy).not.toMatch(/crie uma (página|landing)/i);
    expect(
      validateFounderActionCopy(copy, { ...brief, week_reason: "category_partial" }),
    ).toBeNull();
  });

  it("does not tell the founder to create a page when the measured PDP is the target", () => {
    const pdpBrief: TrackLlmContentBriefForCopy = {
      ...brief,
      target_url: "https://completebari.com.br/products/multivitaminico-complete-bari-multi",
      surface: "pdp_medida",
      week_reason: "category_partial",
    };
    const copy = buildDeterministicFounderActionCopy(pdpBrief);

    expect(copy).toContain("A sua página do produto já existe");
    expect(copy).not.toMatch(/crie uma (página|landing)/i);
    expect(copy).not.toContain("23 Nutrientes");
    expect(validateFounderActionCopy(copy, pdpBrief)).toBeNull();
    expect(
      validateFounderActionCopy(
        "Crie uma página no seu site para quem busca caneta sem saber o nome da loja.",
        pdpBrief,
      ),
    ).toBe("create_page_on_existing_url");
  });

  it("keeps the price/brand recado when the week is incoherent even if the surface is the PDP", () => {
    const copy = buildDeterministicFounderActionCopy({
      ...brief,
      target_url: "https://nuture.com.br/products/nuture-daily-boost",
      surface: "pdp_medida",
      incoherent: true,
      week_reason: "incoherent",
    });

    expect(copy).toContain("já fala de você");
    expect(copy).toContain("não batem com a loja");
    expect(copy).not.toContain("A sua página do produto já existe");
  });

  it("rejects copy that invents a URL", () => {
    const reason = validateFounderActionCopy(
      "Melhore esta página. Veja também https://outra-url.com.",
      brief,
    );

    expect(reason).toBe("invented_url");
  });

  it("rejects forbidden attributes used as positive claims", () => {
    const reason = validateFounderActionCopy(
      "Melhore esta página. Mostre a Certificação NSF com destaque.",
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
    expect(result.first_action).toContain("Melhore esta página");
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
      week_reason: "catalog_first",
    };
    const copy = buildDeterministicFounderActionCopy(catalogBrief);

    expect(copy).toContain("Complete no Shopify");
    expect(copy).toContain("cadastro é a base");
    expect(copy).not.toContain("Melhore esta página");
    expect(copy).toContain("ficha que já existe");
    expect(copy).not.toMatch(/crie uma (página|landing)/i);
    expect(validateFounderActionCopy(copy, catalogBrief)).toBeNull();
    expect(
      validateFounderActionCopy(
        "Crie um blog sobre greens para o Nuture Daily Boost nesta página: https://nuture.com.br/products/nuture-daily-boost.",
        catalogBrief,
      ),
    ).toBe("missing_catalog_first");
  });

  it("rejects generic copy when the brief is incoherent or named-without-store", () => {
    const generic = "Melhore esta página. Ela pode ser a fonte da IA sobre greens.";

    expect(
      validateFounderActionCopy(generic, { ...brief, incoherent: true, week_reason: "incoherent" }),
    ).toBe("missing_incoherent");
    expect(
      validateFounderActionCopy(generic, {
        ...brief,
        sourcesWithoutStore: true,
        week_reason: "sources_without_store",
      }),
    ).toBe("missing_sources_without_store");
    expect(
      validateFounderActionCopy(
        buildDeterministicFounderActionCopy({
          ...brief,
          incoherent: true,
          week_reason: "incoherent",
        }),
        { ...brief, incoherent: true, week_reason: "incoherent" },
      ),
    ).toBeNull();
  });
});

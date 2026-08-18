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
});

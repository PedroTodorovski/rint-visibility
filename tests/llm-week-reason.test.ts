import { describe, expect, it } from "vitest";
import { resolveLlmWeekReason } from "../src/services/llm-week-reason.js";

const categoryMiss = {
  categoryCited: 1,
  categoryTotal: 3,
  namedCited: 2,
  namedTotal: 2,
};

describe("resolveLlmWeekReason", () => {
  it("picks category_partial on 1–4/N with a category miss, not incoherent", () => {
    expect(
      resolveLlmWeekReason({
        catalogFirst: false,
        storefrontIncoherent: false,
        sourcesWithoutStore: false,
        citationClient: 3,
        citationTotal: 5,
        split: categoryMiss,
      }),
    ).toBe("category_partial");
  });

  it("lets a named storefront pair win even on 5/5", () => {
    expect(
      resolveLlmWeekReason({
        catalogFirst: false,
        storefrontIncoherent: true,
        sourcesWithoutStore: false,
        citationClient: 5,
        citationTotal: 5,
        split: {
          categoryCited: 3,
          categoryTotal: 3,
          namedCited: 2,
          namedTotal: 2,
        },
      }),
    ).toBe("incoherent");
  });

  it("does not paint incoherent from 0/N named-without-store", () => {
    expect(
      resolveLlmWeekReason({
        catalogFirst: false,
        storefrontIncoherent: false,
        sourcesWithoutStore: true,
        citationClient: 0,
        citationTotal: 5,
        split: null,
      }),
    ).toBe("sources_without_store");
  });
});

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

  it("returns not cited for generic response", () => {
    const result = detectCitation("Nike and Adidas are popular brands.", ctx);
    expect(result.cited).toBe(false);
    expect(result.matchSignals).toHaveLength(0);
  });
});

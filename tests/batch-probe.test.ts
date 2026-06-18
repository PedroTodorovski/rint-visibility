import { describe, expect, it } from "vitest";

import { buildSingleProbeMessage, parseBatchProbeResponse } from "../src/lib/llm/batch-probe.js";

describe("batch-probe", () => {
  it("wraps buyer prompts with mandatory web-search instructions", () => {
    const message = buildSingleProbeMessage("Sofá em caixa pela internet");

    expect(message).toContain("Sofá em caixa pela internet");
    expect(message).toContain("Search the web");
    expect(message).toContain("REQUIRED");
  });

  it("parses JSON batch responses by index", () => {
    const raw = `{"responses":[{"index":1,"answer":"Try Brand A."},{"index":2,"answer":"Brand B is solid."}]}`;
    const parsed = parseBatchProbeResponse(raw, [1, 2]);

    expect(parsed.get(1)).toBe("Try Brand A.");
    expect(parsed.get(2)).toBe("Brand B is solid.");
  });

  it("parses fenced JSON batch responses", () => {
    const raw = '```json\n{"responses":[{"index":3,"answer":"Check example.com"}]}\n```';
    const parsed = parseBatchProbeResponse(raw, [3]);

    expect(parsed.get(3)).toBe("Check example.com");
  });
});

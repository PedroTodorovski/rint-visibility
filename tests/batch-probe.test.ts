import { describe, expect, it } from "vitest";

import { buildBatchProbeMessage, parseBatchProbeResponse } from "../src/lib/llm/batch-probe.js";

describe("batch-probe", () => {
  it("builds a numbered multi-prompt message", () => {
    const message = buildBatchProbeMessage([
      { index: 1, text: "best sofa" },
      { index: 2, text: "modular couch" },
    ]);

    expect(message).toContain("1. best sofa");
    expect(message).toContain("2. modular couch");
    expect(message).toContain('"responses"');
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

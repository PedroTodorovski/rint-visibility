import { describe, expect, it } from "vitest";

import { compareProbeResults } from "../src/services/probe-compare.js";
import type { ResultWithPrompt } from "../src/repositories/types.js";

function row(
  probeRunId: string,
  promptId: string,
  promptText: string,
  cited: boolean,
): ResultWithPrompt {
  return {
    id: `${probeRunId}-${promptId}`,
    probe_run_id: probeRunId,
    prompt_id: promptId,
    provider: "claude",
    cited,
    response_excerpt: null,
    metadata: {},
    created_at: "2026-06-17T10:00:00.000Z",
    prompt_text: promptText,
    probe_completed_at: "2026-06-17T11:00:00.000Z",
  };
}

describe("compareProbeResults", () => {
  it("computes cited delta and per-slot changes", () => {
    const comparison = compareProbeResults(
      "run-a",
      "run-b",
      [row("run-a", "p1", "first", false), row("run-a", "p2", "second", true)],
      [row("run-b", "p1", "first", true), row("run-b", "p2", "second", true)],
    );

    expect(comparison.cited_delta).toBe(1);
    expect(comparison.slots.find((s) => s.prompt_id === "p1")?.changed).toBe(true);
    expect(comparison.slots.find((s) => s.prompt_id === "p2")?.changed).toBe(false);
  });
});

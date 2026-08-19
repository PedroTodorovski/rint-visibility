import { describe, expect, it } from "vitest";

import {
  assertUsableShopperEvidence,
  enabledDiagnosticClients,
  isUsableShopperEvidence,
  queryCoversProviders,
  queryHasUsableShopperEvidence,
  SHOPPER_EVIDENCE_MISSING,
  shopperEvidenceProvider,
} from "../src/lib/llm/index.js";
import type { LlmClient, LlmClients } from "../src/lib/llm/types.js";

const stubClient: LlmClient = {
  async probe() {
    return { text: "", model: "mock", mocked: true };
  },
  async probeBatch() {
    return { responses: [], model: "mock", mocked: true };
  },
};

describe("shopper evidence contract", () => {
  it("rejects empty and mocked shopper text", () => {
    expect(isUsableShopperEvidence({ rawText: "", mocked: false })).toBe(false);
    expect(isUsableShopperEvidence({ raw_text: "ok", mocked: true })).toBe(false);
    expect(isUsableShopperEvidence({ rawText: "  loja X  ", mocked: false })).toBe(true);
    expect(() => assertUsableShopperEvidence({ raw_text: "", mocked: false })).toThrow(
      SHOPPER_EVIDENCE_MISSING,
    );
  });

  it("lists only clients that can diagnose a query", () => {
    const llm: LlmClients = {
      gemini: {
        ...stubClient,
        diagnoseQuery: async () => {
          throw new Error("unused");
        },
      },
      chatgpt: stubClient,
      perplexity: {
        ...stubClient,
        diagnoseQuery: async () => {
          throw new Error("unused");
        },
      },
    };
    expect(enabledDiagnosticClients(llm).map((row) => row.provider)).toEqual([
      "gemini",
      "perplexity",
    ]);
  });

  it("treats missing provider as gemini and skips hollow day-photo evidence", () => {
    expect(shopperEvidenceProvider({})).toBe("gemini");
    expect(
      queryHasUsableShopperEvidence({
        gemini_raw: "",
        executions: [{ raw_text: "", mocked: true }],
      }),
    ).toBe(false);
    expect(
      queryCoversProviders(
        {
          executions: [
            { raw_text: "ok", mocked: false, provider: "gemini" },
            { raw_text: "", mocked: true, provider: "chatgpt" },
          ],
        },
        ["gemini", "chatgpt"],
      ),
    ).toBe(false);
    expect(
      queryCoversProviders(
        {
          executions: [{ raw_text: "ok", mocked: false, provider: "gemini" }],
        },
        ["gemini"],
      ),
    ).toBe(true);
  });
});

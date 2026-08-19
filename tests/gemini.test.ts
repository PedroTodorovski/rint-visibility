import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { createGeminiClient, visibleTextFromGeminiParts } from "../src/lib/llm/gemini.js";
import { SHOPPER_EVIDENCE_MISSING } from "../src/lib/llm/shopper-evidence.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function diagnoseQueryOf(client: ReturnType<typeof createGeminiClient>) {
  const diagnoseQuery = client.diagnoseQuery;
  if (!diagnoseQuery) throw new Error("diagnoseQuery missing");
  return diagnoseQuery;
}

function groundingPayload(text: string) {
  return {
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text }] },
        groundingMetadata: {
          groundingChunks: [{ web: { uri: "https://www.decathlon.com.br", title: "Decathlon" } }],
        },
      },
    ],
  };
}

describe("visibleTextFromGeminiParts", () => {
  it("skips thought parts and joins visible text", () => {
    expect(
      visibleTextFromGeminiParts([
        { thought: true, text: "rascunho interno" },
        { text: "Compre na loja X." },
      ]),
    ).toBe("Compre na loja X.");
  });

  it("returns empty when only thought or MAX_TOKENS left no visible parts", () => {
    expect(visibleTextFromGeminiParts([{ thought: true, text: "..." }])).toBe("");
    expect(visibleTextFromGeminiParts([])).toBe("");
  });
});

describe("Gemini grounded diagnoseQuery", () => {
  it("retries 429 then returns shopper text", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("rate", { status: 429 });
      }
      return new Response(JSON.stringify(groundingPayload("A prancha aparece na Decathlon.")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createGeminiClient(
      loadConfig({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-2.5-flash" }),
    );
    const result = await diagnoseQueryOf(client)({
      query: "prancha snowboard",
      storeName: "Acme",
      domain: "acme.example",
      productUrl: "https://acme.example/p",
      productName: "Board",
      productAttributes: [],
      temperature: 0,
    });

    expect(result.mocked).toBe(false);
    expect(result.rawText).toContain("Decathlon");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("throws shopper_evidence_missing on HTTP 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 400 })),
    );
    const client = createGeminiClient(loadConfig({ GEMINI_API_KEY: "test-key" }));
    await expect(
      diagnoseQueryOf(client)({
        query: "prancha snowboard",
        storeName: "Acme",
        domain: "acme.example",
        productUrl: "https://acme.example/p",
        productName: "Board",
        productAttributes: [],
        temperature: 0,
      }),
    ).rejects.toThrow(SHOPPER_EVIDENCE_MISSING);
  });

  it("throws when the API returns MAX_TOKENS with no visible text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const client = createGeminiClient(loadConfig({ GEMINI_API_KEY: "test-key" }));
    await expect(
      diagnoseQueryOf(client)({
        query: "prancha snowboard",
        storeName: "Acme",
        domain: "acme.example",
        productUrl: "https://acme.example/p",
        productName: "Board",
        productAttributes: [],
        temperature: 0,
      }),
    ).rejects.toThrow(SHOPPER_EVIDENCE_MISSING);
  });
});

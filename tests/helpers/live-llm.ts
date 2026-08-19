import { emptyCitedObject, emptyGeminiStructured } from "../../src/lib/llm/gemini-structured.js";
import type {
  LlmClient,
  LlmClients,
  LlmStructuredDiagnosticResult,
} from "../../src/lib/llm/types.js";

export function liveDiagnosticResult(
  query: string,
  overrides: Partial<LlmStructuredDiagnosticResult> = {},
): LlmStructuredDiagnosticResult {
  return {
    rawText: `Resposta de comprador para: ${query}`,
    structured: {
      ...emptyGeminiStructured(),
      cliente_foi_citado: false,
      objetos_citados: [
        {
          ...emptyCitedObject(),
          marca: "Burton",
          loja: "Decathlon",
        },
      ],
    },
    model: "gemini-2.5-flash",
    mocked: false,
    usedWebSearch: true,
    groundingUrls: ["https://www.decathlon.com.br/snowboard"],
    calls: [
      { type: "text", usedWebSearch: true, model: "gemini-2.5-flash" },
      { type: "structure", usedWebSearch: true, model: "gemini-2.5-flash" },
    ],
    ...overrides,
  };
}

export function stubLlmClient(diagnoseQuery?: LlmClient["diagnoseQuery"]): LlmClient {
  return {
    async probe() {
      return { text: "", model: "mock", mocked: true };
    },
    async probeBatch() {
      return { responses: [], model: "mock", mocked: true };
    },
    diagnoseQuery: diagnoseQuery ?? (async (input) => liveDiagnosticResult(input.query)),
  };
}

export function liveLlm(overrides: Partial<LlmClients> = {}): LlmClients {
  return {
    gemini: stubLlmClient(),
    ...overrides,
  };
}

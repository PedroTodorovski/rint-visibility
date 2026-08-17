import type { GeminiStructuredOutput } from "./gemini-structured.js";

export type LlmProvider = "gemini";

export type LlmProbeResult = {
  text: string;
  model: string;
  mocked: boolean;
  usedWebSearch?: boolean;
  groundingUrls?: string[];
};

export type LlmBatchProbeResult = {
  responses: Array<{ index: number; text: string; groundingUrls?: string[] }>;
  model: string;
  mocked: boolean;
  usedWebSearch?: boolean;
};

export type LlmStructuredDiagnosticResult = {
  rawText: string;
  structured: GeminiStructuredOutput;
  model: string;
  mocked: boolean;
  usedWebSearch: boolean;
  groundingUrls: string[];
  calls: Array<{ type: "text" | "structure"; usedWebSearch: boolean; model: string }>;
};

export type LlmClient = {
  probe(prompt: string): Promise<LlmProbeResult>;
  probeBatch(items: Array<{ index: number; text: string }>): Promise<LlmBatchProbeResult>;
  diagnoseQuery?(input: {
    query: string;
    storeName: string;
    domain: string | null;
    productUrl: string;
    productName: string;
    productAttributes: string[];
    temperature: number;
  }): Promise<LlmStructuredDiagnosticResult>;
};

export type LlmClients = {
  gemini: LlmClient;
};

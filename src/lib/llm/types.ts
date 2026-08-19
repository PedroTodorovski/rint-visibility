import type { GeminiStructuredOutput } from "./gemini-structured.js";

export const LLM_PROVIDER_IDS = ["gemini", "chatgpt", "perplexity"] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];
/** @deprecated Use LlmProviderId */
export type LlmProvider = LlmProviderId;

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
  groundingChunks?: Array<{ uri: string; title?: string }>;
  groundingSupports?: Array<{ text: string; uris: string[] }>;
  calls: Array<{ type: "text" | "structure"; usedWebSearch: boolean; model: string }>;
};

export type LlmFounderActionCopyResult = {
  text: string;
  model: string;
  mocked: boolean;
};

export type LlmClient = {
  probe(prompt: string): Promise<LlmProbeResult>;
  probeBatch(items: Array<{ index: number; text: string }>): Promise<LlmBatchProbeResult>;
  renderFounderAction?(input: {
    deterministicAction: string;
    contentBrief: Record<string, unknown>;
    fallbackCopy: string;
    language: "pt-BR";
  }): Promise<LlmFounderActionCopyResult>;
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
  chatgpt?: LlmClient;
  perplexity?: LlmClient;
};

export type EnabledDiagnosticClient = {
  provider: LlmProviderId;
  client: LlmClient;
};

export function enabledDiagnosticClients(llm: LlmClients): EnabledDiagnosticClient[] {
  const out: EnabledDiagnosticClient[] = [];
  for (const provider of LLM_PROVIDER_IDS) {
    const client = llm[provider];
    if (client?.diagnoseQuery) out.push({ provider, client });
  }
  return out;
}

export function isLlmProviderId(value: string | null | undefined): value is LlmProviderId {
  return Boolean(value && (LLM_PROVIDER_IDS as readonly string[]).includes(value));
}

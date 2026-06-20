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

export type LlmClient = {
  probe(prompt: string): Promise<LlmProbeResult>;
  probeBatch(items: Array<{ index: number; text: string }>): Promise<LlmBatchProbeResult>;
};

export type LlmClients = {
  gemini: LlmClient;
};

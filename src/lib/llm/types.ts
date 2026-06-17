export type LlmProvider = "chatgpt" | "gemini";

export type LlmProbeResult = {
  text: string;
  model: string;
  mocked: boolean;
};

export type LlmClient = {
  probe(prompt: string): Promise<LlmProbeResult>;
};

export type LlmClients = {
  chatgpt: LlmClient;
  gemini: LlmClient;
};

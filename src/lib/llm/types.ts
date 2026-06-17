export type LlmProvider = "claude" | "chatgpt" | "gemini";

export type LlmProbeResult = {
  text: string;
  model: string;
  mocked: boolean;
};

export type LlmClient = {
  probe(prompt: string): Promise<LlmProbeResult>;
};

export type LlmClients = {
  claude: LlmClient;
  chatgpt: LlmClient;
  gemini: LlmClient;
};

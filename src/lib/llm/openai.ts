import type { AppConfig } from "../../config.js";
import type { LlmClient, LlmProbeResult } from "./types.js";

const DEFAULT_MODEL = "gpt-4o-mini";

export function createOpenAiClient(config: AppConfig): LlmClient {
  const apiKey = config.openAiApiKey;

  return {
    async probe(prompt: string): Promise<LlmProbeResult> {
      if (!apiKey) {
        return { text: "", model: "mock", mocked: true };
      }

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.openAiModel ?? DEFAULT_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1024,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenAI API error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
      };

      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      return { text, model: data.model ?? config.openAiModel ?? DEFAULT_MODEL, mocked: false };
    },
  };
}

import type { AppConfig } from "../../config.js";
import type { LlmClient, LlmProbeResult } from "./types.js";

const DEFAULT_MODEL = "gemini-2.0-flash";

export function createGeminiClient(config: AppConfig): LlmClient {
  const apiKey = config.geminiApiKey;
  const model = config.geminiModel ?? DEFAULT_MODEL;

  return {
    async probe(prompt: string): Promise<LlmProbeResult> {
      if (!apiKey) {
        return { text: "", model: "mock", mocked: true };
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!res.ok) {
          return { text: "", model: "mock", mocked: true };
        }

        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
        return { text, model, mocked: false };
      } catch {
        return { text: "", model: "mock", mocked: true };
      }
    },
  };
}

import type { AppConfig } from "../../config.js";
import { extractGroundingMetadata } from "../gemini-grounding.js";
import { buildSingleProbeMessage } from "./batch-probe.js";
import {
  emptyCitedObject,
  emptyGeminiStructured,
  GEMINI_STRUCTURE_PROMPT_SHAPE,
  hydrateGeminiStructured,
  parseGeminiStructuredOutput,
} from "./gemini-structured.js";
import type { LlmClient, LlmProbeResult, LlmStructuredDiagnosticResult } from "./types.js";

const DEFAULT_MODEL = "gemini-2.0-flash";

export type GeminiProbeExtras = {
  groundingUrls: string[];
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
};

async function callGeminiWithGrounding(
  apiKey: string,
  model: string,
  userContent: string,
  temperature = 0.7,
): Promise<{ text: string; model: string; groundingUrls: string[] } | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userContent }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature, maxOutputTokens: 2048 },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as GeminiGenerateResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  if (!text) return null;

  const grounding = extractGroundingMetadata(data);
  const groundingUrls = grounding.chunks.map((c) => c.uri);

  return { text, model, groundingUrls };
}

function mockStructuredFromShopperAnswer(): LlmStructuredDiagnosticResult["structured"] {
  return hydrateGeminiStructured({
    ...emptyGeminiStructured(),
    concorrente_citado_nome: "Decathlon",
    nome_marca_citada: "Burton",
    objetos_citados: [
      {
        ...emptyCitedObject(),
        marca: "Burton",
        loja: "Decathlon",
      },
      {
        ...emptyCitedObject(),
        loja: "Mercado Livre",
      },
    ],
  });
}

function buildDiagnosticTextPrompt(query: string): string {
  return `You are answering a real ecommerce shopper query in Brazil.

Shopper query:
"${query}"

REQUIRED:
1. Search the web with Google Search grounding.
2. Answer as Gemini would answer the shopper, citing real brands/products/URLs only when they appear in grounded search results.
3. Do not return JSON.
4. Do not invent a store, brand, product, or URL that search did not surface.
5. If a specific store or product is not in the grounded results, say it was not found. Do not recommend it anyway.
6. Answer in the same language as the shopper query.`;
}

function buildDiagnosticStructurePrompt(rawText: string): string {
  return `Search the web again with Google Search grounding, then convert the quoted Gemini-style answer below into strict JSON only.

Quoted answer:
"""
${rawText}
"""

Return exactly this JSON shape:
${GEMINI_STRUCTURE_PROMPT_SHAPE}

Rules:
- Do not add markdown.
- Use null or [] when the quoted answer and grounding did not state the fact. Do not invent.
- objetos_citados: one entry per distinct product or store named in the quoted answer or grounding.
- Put a fact on that object only (price, dimensions, quality, delivery time, rating, attributes). Copy the phrase as stated; do not normalize into a scale you did not see.
- Preserve URL only when it is explicit in the quoted answer or grounding.
- Do not infer a price if no price is cited.
- atributos are characteristics of THAT object only (material, color, size, warranty, etc.).
- Singular fields stay for compatibility: primary cited object, or the competitor if the client was not cited.
- Set cliente_foi_citado true only if the quoted answer recommends the shopper buy from that store or product. A mention that the store or product was not found is false.`;
}

export function createGeminiClient(config: AppConfig): LlmClient {
  const apiKey = config.geminiApiKey;
  const model = config.geminiModel ?? DEFAULT_MODEL;

  const client: LlmClient = {
    async probe(prompt: string): Promise<LlmProbeResult> {
      if (!apiKey) {
        return { text: "", model: "mock", mocked: true };
      }

      try {
        const message = buildSingleProbeMessage(prompt);
        const result = await callGeminiWithGrounding(apiKey, model, message);
        if (!result?.text) {
          return { text: "", model: "mock", mocked: true };
        }

        return {
          text: result.text,
          model: result.model,
          mocked: false,
          usedWebSearch: result.groundingUrls.length > 0,
          groundingUrls: result.groundingUrls,
        };
      } catch {
        return { text: "", model: "mock", mocked: true };
      }
    },

    async probeBatch(items) {
      if (items.length === 0) {
        return { responses: [], model: "mock", mocked: true };
      }

      if (!apiKey) {
        return { responses: [], model: "mock", mocked: true };
      }

      const responses: Array<{ index: number; text: string; groundingUrls?: string[] }> = [];
      let mocked = false;
      let batchModel = model;
      let usedWebSearch = false;

      for (const item of items) {
        const result = await client.probe(item.text);
        if (result.mocked || !result.text) mocked = true;
        batchModel = result.model;
        if (result.usedWebSearch) usedWebSearch = true;
        responses.push({
          index: item.index,
          text: result.text,
          groundingUrls: result.groundingUrls,
        });
      }

      return {
        responses,
        model: batchModel,
        mocked,
        usedWebSearch,
      };
    },

    async diagnoseQuery(input): Promise<LlmStructuredDiagnosticResult> {
      if (!apiKey) {
        return {
          rawText:
            "Decathlon, Burton e Mercado Livre aparecem com frequência para quem busca prancha de snowboard no Brasil.",
          structured: mockStructuredFromShopperAnswer(),
          model: "mock",
          mocked: true,
          usedWebSearch: false,
          groundingUrls: [],
          calls: [
            { type: "text", usedWebSearch: false, model: "mock" },
            { type: "structure", usedWebSearch: false, model: "mock" },
          ],
        };
      }

      const textPrompt = buildDiagnosticTextPrompt(input.query);
      const first = await callGeminiWithGrounding(apiKey, model, textPrompt, input.temperature);
      if (!first?.text) {
        return {
          rawText: "",
          structured: emptyGeminiStructured(),
          model: "mock",
          mocked: true,
          usedWebSearch: false,
          groundingUrls: [],
          calls: [
            { type: "text", usedWebSearch: false, model: "mock" },
            { type: "structure", usedWebSearch: false, model: "mock" },
          ],
        };
      }

      const structurePrompt = buildDiagnosticStructurePrompt(first.text);
      const second = await callGeminiWithGrounding(
        apiKey,
        model,
        structurePrompt,
        input.temperature,
      );
      const structured = second?.text ? parseGeminiStructuredOutput(second.text) : null;

      return {
        rawText: first.text,
        structured: structured ?? emptyGeminiStructured(),
        model,
        mocked: false,
        usedWebSearch: first.groundingUrls.length > 0 || (second?.groundingUrls.length ?? 0) > 0,
        groundingUrls: [...new Set([...first.groundingUrls, ...(second?.groundingUrls ?? [])])],
        calls: [
          { type: "text", usedWebSearch: first.groundingUrls.length > 0, model: first.model },
          {
            type: "structure",
            usedWebSearch: (second?.groundingUrls.length ?? 0) > 0,
            model: second?.model ?? model,
          },
        ],
      };
    },
  };

  return client;
}

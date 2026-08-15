import type { AppConfig } from "../../config.js";
import { detectCitation } from "../citation.js";
import { extractGroundingMetadata } from "../gemini-grounding.js";
import { buildSingleProbeMessage } from "./batch-probe.js";
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

function extractJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1]!.trim();
  const object = text.match(/\{[\s\S]*\}/);
  if (object) text = object[0]!;

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d,.-]/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildDiagnosticTextPrompt(input: {
  query: string;
  storeName: string;
  domain: string | null;
  productUrl: string;
  productName: string;
  productAttributes: string[];
}): string {
  return `You are evaluating how Gemini answers a real ecommerce shopper query in Brazil.

Shopper query:
"${input.query}"

Client brand/store:
${input.storeName}

Client domain:
${input.domain ?? "unknown"}

Client PDP:
${input.productUrl}

Client product from Shopify:
${input.productName}

Known Shopify attributes:
${input.productAttributes.length > 0 ? input.productAttributes.map((a) => `- ${a}`).join("\n") : "- none"}

REQUIRED:
1. Search the web with Google Search grounding.
2. Answer as Gemini would answer the shopper, citing real brands/products/URLs when useful.
3. Do not return JSON.
4. Include competitor product/store URLs if they are surfaced by grounded search.
5. Answer in the same language as the shopper query.`;
}

function buildDiagnosticStructurePrompt(rawText: string): string {
  return `Search the web again with Google Search grounding, then convert the quoted Gemini-style answer below into strict JSON only.

Quoted answer:
"""
${rawText}
"""

Return exactly this JSON shape:
{
  "cliente_foi_citado": boolean,
  "concorrente_citado_nome": string | null,
  "concorrente_citado_url": string | null,
  "atributos_mencionados_gemini": string[],
  "preco_citado": number | null,
  "nome_marca_citada": string | null,
  "produto_mencionado": string | null
}

Rules:
- Do not add markdown.
- Use null when unknown.
- Preserve competitor URL only when it is explicit in the quoted answer or grounding context.
- Do not infer a price if no price is cited.`;
}

function parseStructuredOutput(raw: string): LlmStructuredDiagnosticResult["structured"] | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  return {
    cliente_foi_citado: parsed.cliente_foi_citado === true,
    concorrente_citado_nome: stringOrNull(parsed.concorrente_citado_nome),
    concorrente_citado_url: stringOrNull(parsed.concorrente_citado_url),
    atributos_mencionados_gemini: stringArray(parsed.atributos_mencionados_gemini),
    preco_citado: numberOrNull(parsed.preco_citado),
    nome_marca_citada: stringOrNull(parsed.nome_marca_citada),
    produto_mencionado: stringOrNull(parsed.produto_mencionado),
  };
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
        const citation = detectCitation(
          `Recomendo avaliar ${input.productName} em ${input.productUrl}.`,
          {
            storeName: input.storeName,
            domain: input.domain,
            productUrls: [input.productUrl],
            promptText: input.query,
          },
        );

        return {
          rawText:
            citation.excerpt || `Recomendo avaliar ${input.productName} em ${input.productUrl}.`,
          structured: {
            cliente_foi_citado: citation.cited,
            concorrente_citado_nome: null,
            concorrente_citado_url: null,
            atributos_mencionados_gemini: input.productAttributes.slice(0, 3),
            preco_citado: null,
            nome_marca_citada: input.storeName,
            produto_mencionado: input.productName,
          },
          model: "mock",
          mocked: true,
          usedWebSearch: true,
          groundingUrls: [input.productUrl],
          calls: [
            { type: "text", usedWebSearch: true, model: "mock" },
            { type: "structure", usedWebSearch: true, model: "mock" },
          ],
        };
      }

      const textPrompt = buildDiagnosticTextPrompt(input);
      const first = await callGeminiWithGrounding(apiKey, model, textPrompt, input.temperature);
      if (!first?.text) {
        return {
          rawText: "",
          structured: {
            cliente_foi_citado: false,
            concorrente_citado_nome: null,
            concorrente_citado_url: null,
            atributos_mencionados_gemini: [],
            preco_citado: null,
            nome_marca_citada: null,
            produto_mencionado: null,
          },
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
      const structured = second?.text ? parseStructuredOutput(second.text) : null;

      return {
        rawText: first.text,
        structured: structured ?? {
          cliente_foi_citado: false,
          concorrente_citado_nome: null,
          concorrente_citado_url: null,
          atributos_mencionados_gemini: [],
          preco_citado: null,
          nome_marca_citada: null,
          produto_mencionado: null,
        },
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

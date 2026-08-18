import { isShopifyAdminHost, normalizeHost, type ResolvedGroundingUrl } from "./citation-gold.js";

export type GroundingChunk = {
  uri: string;
  title?: string;
};

export type GroundingSupportSpan = {
  text: string;
  start?: number;
  end?: number;
  chunk_indices: number[];
};

export type GroundingSupportRef = {
  text: string;
  uris: string[];
};

export type BoundGroundingSupport = {
  text: string;
  hosts: string[];
  /** Resolved shopper URLs for this span's chunks — never a guessed homepage. */
  hrefs: string[];
};

export type GeminiGroundingMetadata = {
  chunks: GroundingChunk[];
  supports: GroundingSupportSpan[];
};

type GeminiApiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      groundingSupports?: Array<{
        segment?: { startIndex?: number; endIndex?: number; text?: string };
        groundingChunkIndices?: number[];
      }>;
    };
  }>;
};

export function extractGroundingMetadata(data: GeminiApiResponse): GeminiGroundingMetadata {
  const meta = data.candidates?.[0]?.groundingMetadata;
  const chunks: GroundingChunk[] = [];

  for (const chunk of meta?.groundingChunks ?? []) {
    const uri = chunk.web?.uri?.trim();
    if (!uri) continue;
    chunks.push({ uri, title: chunk.web?.title });
  }

  const supports: GroundingSupportSpan[] = [];
  for (const row of meta?.groundingSupports ?? []) {
    const text = row.segment?.text?.replace(/\s+/g, " ").trim();
    if (!text) continue;
    supports.push({
      text,
      start: row.segment?.startIndex,
      end: row.segment?.endIndex,
      chunk_indices: (row.groundingChunkIndices ?? []).filter((index) => Number.isInteger(index)),
    });
  }

  return { chunks, supports };
}

export function groundingUrlsToCitationText(chunks: GroundingChunk[]): string {
  if (chunks.length === 0) return "";
  return chunks.map((c) => `${c.title ?? "Source"}: ${c.uri}`).join("\n");
}

function hostFromUri(uri: string): string | null {
  try {
    return normalizeHost(new URL(uri).hostname);
  } catch {
    return normalizeHost(uri);
  }
}

function isGoogleRedirectHref(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "vertexaisearch.cloud.google.com" ||
      host === "www.google.com" ||
      host === "google.com"
    ) {
      return true;
    }
    return parsed.pathname.includes("grounding-api-redirect");
  } catch {
    return false;
  }
}

function shopperHrefForUri(uri: string, resolved: ResolvedGroundingUrl[]): string | null {
  const row = resolved.find((item) => item.from === uri || item.to === uri);
  const candidates = [row?.to, uri].filter((value): value is string => Boolean(value?.trim()));
  for (const candidate of candidates) {
    if (isGoogleRedirectHref(candidate)) continue;
    const host = hostFromUri(candidate);
    if (!host || isShopifyAdminHost(host)) continue;
    return candidate;
  }
  return null;
}

/** Bind support indices to the chunks of that same Gemini response — never a merged list. */
export function supportRefsFromSpans(
  supports: GroundingSupportSpan[] | undefined,
  chunks: Array<{ uri: string }>,
): GroundingSupportRef[] {
  const refs: GroundingSupportRef[] = [];
  for (const support of supports ?? []) {
    const text = support.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const uris = [
      ...new Set(
        support.chunk_indices
          .map((index) => chunks[index]?.uri?.trim())
          .filter((uri): uri is string => Boolean(uri)),
      ),
    ];
    refs.push({ text, uris });
  }
  return refs;
}

/** Map first-pass support URIs onto resolved shopper pages. Never invent `https://{host}`. */
export function bindGroundingSupports(
  refs: GroundingSupportRef[] | undefined,
  resolved: ResolvedGroundingUrl[],
): BoundGroundingSupport[] {
  const bound: BoundGroundingSupport[] = [];
  for (const ref of refs ?? []) {
    const text = ref.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const citations: Array<{ host: string; href: string }> = [];
    for (const uri of ref.uris) {
      const href = shopperHrefForUri(uri, resolved);
      if (!href) continue;
      const host = hostFromUri(href);
      if (!host || citations.some((item) => item.host === host || item.href === href)) continue;
      citations.push({ host, href });
    }
    bound.push({
      text,
      hosts: [...new Set(citations.map((item) => item.host))],
      hrefs: citations.map((item) => item.href),
    });
  }
  return bound;
}

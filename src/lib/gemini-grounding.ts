import {
  hostMatchesClient,
  isShopifyAdminHost,
  normalizeHost,
  type ResolvedGroundingUrl,
} from "./citation-gold.js";
import { foldIdentity } from "./cited-offer.js";

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

function needlesFor(names: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      names
        .map((name) => (name ?? "").trim())
        .filter((name) => name.length >= 3)
        .map(foldIdentity),
    ),
  ];
}

/**
 * ADR-003 residual gap, closed: true per-object grounding attribution, computed together for
 * every cited object in one execution so the objects can disambiguate each other. `bindGroundingSupports`
 * already resolves each grounded sentence of the shopper answer to its own host(s) — for each
 * sentence, this finds which of the given objects it names (by marca/produto/loja) and, only when
 * the sentence names EXACTLY ONE of them, uses that sentence's resolved host as a signal for that
 * one object. A sentence that names more than one object at once (e.g. a client brand that is
 * itself a text prefix of a competitor's longer brand — "Acme" inside "Acme Studio" — or a
 * compound sentence naming both) contributes no signal to any of them: it's ambiguous, not
 * evidence.
 *
 * Once at least one object is positively confirmed (a sentence naming only it resolved to the
 * client's own host), every *other*, distinctly-keyed object gets `false` — not because its own
 * sentence failed to resolve to the client (that would wrongly penalize the client's own product
 * cited only via a marketplace/reseller listing, a normal and common pattern), but because a
 * specific alternative has now been positively identified as the real client mention in this same
 * result, so this one does not need to borrow that identity via fuzzy name matching. If NO object
 * gets a positive confirmation at all, every object gets `undefined` (no signal) — this needs no
 * extra Gemini call, since the data was already being computed and thrown away downstream of the
 * sentence-level match. Callers must treat `undefined` as "no signal" and fall back to the coarser
 * per-execution `cliente_foi_citado`, never as a negative.
 */
export function objectGroundingVerdicts(
  objects: Array<{ names: Array<string | null | undefined> }>,
  supports: BoundGroundingSupport[],
  clientHosts: string[],
): Array<boolean | undefined> {
  const needleSets = objects.map((object) => needlesFor(object.names));
  const results: Array<boolean | undefined> = objects.map(() => undefined);
  if (clientHosts.length === 0) return results;

  for (const support of supports) {
    const haystack = foldIdentity(support.text);
    const matchedIndexes: number[] = [];
    needleSets.forEach((needles, index) => {
      if (needles.length > 0 && needles.some((needle) => haystack.includes(needle))) {
        matchedIndexes.push(index);
      }
    });
    if (matchedIndexes.length !== 1) continue;
    const index = matchedIndexes[0] as number;
    if (support.hosts.some((host) => hostMatchesClient(host, clientHosts))) {
      results[index] = true;
    }
  }

  const confirmed = results.some((value) => value === true);
  if (!confirmed) return results;
  return results.map((value) => value ?? false);
}

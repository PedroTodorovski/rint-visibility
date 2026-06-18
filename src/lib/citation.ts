import type {
  CitationLayer,
  CompetitorMention,
  HighlightSpan,
  WhyCode,
} from "./result-metadata.js";
import {
  citationLayerFromSignals,
  whyCodeFromCitation,
} from "./result-metadata.js";

export type CitationContext = {
  storeName: string;
  domain: string | null;
  productUrls: string[];
  promptText?: string;
};

export type CitationResult = {
  cited: boolean;
  matchSignals: string[];
  matchedUrl: string | null;
  excerpt: string;
  citationLayer: CitationLayer;
  whyCode: WhyCode;
  highlightSpans: HighlightSpan[];
  competitors: CompetitorMention[];
};

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const BRAND_CANDIDATE =
  /\b([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,2})\b/g;

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)].map((m) => m[0]!.replace(/[.,;:!?)]+$/, ""));
}

function brandMentioned(text: string, brand: string): boolean {
  const trimmed = brand.trim();
  if (trimmed.length < 3) return false;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const unicodeBoundary = new RegExp(`(?:^|[^\\p{L}])${escaped}(?:[^\\p{L}]|$)`, "iu");
  if (unicodeBoundary.test(text)) return true;

  return text.toLowerCase().includes(trimmed.toLowerCase());
}

function isStoreHost(host: string, normalizedDomain: string | null, productUrls: string[]): boolean {
  if (!normalizedDomain) return false;
  if (host === normalizedDomain || host.endsWith(`.${normalizedDomain}`)) return true;
  return productUrls.some((url) => {
    try {
      return normalizeDomain(new URL(url).hostname) === host;
    } catch {
      return false;
    }
  });
}

function hostLabel(host: string): string {
  const parts = host.split(".");
  if (parts.length >= 2) {
    return parts[parts.length - 2]!.replace(/-/g, " ");
  }
  return host;
}

function extractCompetitors(
  text: string,
  ctx: CitationContext,
  normalizedDomain: string | null,
): CompetitorMention[] {
  const found = new Map<string, CompetitorMention>();

  for (const rawUrl of extractUrls(text)) {
    try {
      const host = normalizeDomain(new URL(rawUrl).hostname);
      if (isStoreHost(host, normalizedDomain, ctx.productUrls)) continue;
      const key = `domain:${host}`;
      if (!found.has(key)) {
        found.set(key, { name: hostLabel(host), url: rawUrl, type: "domain" });
      }
    } catch {
      /* skip */
    }
  }

  const storeTokens = new Set(
    [ctx.storeName, ctx.storeName.split(/\s+/)[0] ?? ""]
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 3),
  );

  for (const match of text.matchAll(BRAND_CANDIDATE)) {
    const name = match[1]!.trim();
    const lower = name.toLowerCase();
    if (storeTokens.has(lower)) continue;
    if (name.length < 4) continue;
    if (/^(The|Para|Com|Sem|Uma|Seu|Sua)$/i.test(name)) continue;
    const key = `brand:${lower}`;
    if (!found.has(key)) {
      found.set(key, { name, type: "brand" });
    }
  }

  return [...found.values()].slice(0, 8);
}

function findNeedles(
  text: string,
  ctx: CitationContext,
  normalizedDomain: string | null,
  matchedUrl: string | null,
  cited: boolean,
): Array<{ needle: string; kind: HighlightSpan["kind"] }> {
  const needles: Array<{ needle: string; kind: HighlightSpan["kind"] }> = [];

  const primaryToken = ctx.storeName.trim().split(/\s+/)[0] ?? "";
  if (cited && brandMentioned(text, ctx.storeName)) {
    needles.push({ needle: ctx.storeName, kind: "brand" });
  } else if (cited && primaryToken.length >= 4 && brandMentioned(text, primaryToken)) {
    needles.push({ needle: primaryToken, kind: "brand" });
  }

  if (normalizedDomain && text.toLowerCase().includes(normalizedDomain)) {
    needles.push({ needle: normalizedDomain, kind: "domain" });
  }

  if (matchedUrl && text.toLowerCase().includes(matchedUrl.toLowerCase())) {
    needles.push({ needle: matchedUrl, kind: "url" });
  }

  return needles;
}

const KIND_PRIORITY: Record<HighlightSpan["kind"], number> = {
  brand: 0,
  domain: 1,
  url: 2,
};

const PREAMBLE_RE = [
  /^(?:i['']ll|i will|let me)\s+search\b/i,
  /^searching\b/i,
  /^vou\s+(?:buscar|pesquisar|procurar)\b/i,
  /^buscando\b/i,
];

function isPreambleAt(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const lineEnd = text.indexOf("\n", index);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
  return PREAMBLE_RE.some((re) => re.test(line));
}

function snapToWordBoundaryStart(text: string, pos: number): number {
  let i = Math.max(0, Math.min(pos, text.length));
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  return i;
}

function snapToWordBoundaryEnd(text: string, pos: number): number {
  let i = Math.max(0, Math.min(pos, text.length));
  while (i < text.length && !/\s/.test(text[i]!)) i++;
  return i;
}

function snapToSentenceStart(text: string, pos: number): number {
  const windowStart = Math.max(0, pos - 80);
  const chunk = text.slice(windowStart, pos);
  const match = chunk.match(/[.!?]\s+(?=[^.!?]*$)/);
  if (match && match.index !== undefined) {
    return windowStart + match.index + match[0].length;
  }
  return snapToWordBoundaryStart(text, pos);
}

function snapToSentenceEnd(text: string, pos: number): number {
  const windowEnd = Math.min(text.length, pos + 100);
  const chunk = text.slice(pos, windowEnd);
  const match = chunk.match(/[.!?](?:\s|$|\n)/);
  if (match && match.index !== undefined) {
    return pos + match.index + 1;
  }
  return snapToWordBoundaryEnd(text, pos);
}

function findBestAnchor(
  text: string,
  needles: Array<{ needle: string; kind: HighlightSpan["kind"] }>,
): { index: number; length: number } | null {
  let best: { index: number; length: number; score: number } | null = null;
  const lower = text.toLowerCase();

  for (const { needle, kind } of needles) {
    if (!needle) continue;
    const needleLower = needle.toLowerCase();
    let from = 0;
    while (from < text.length) {
      const at = lower.indexOf(needleLower, from);
      if (at === -1) break;
      let score = KIND_PRIORITY[kind] ?? 3;
      if (isPreambleAt(text, at)) score += 5;
      if (!best || score < best.score || (score === best.score && at < best.index)) {
        best = { index: at, length: needle.length, score };
      }
      from = at + needleLower.length;
    }
  }

  return best ? { index: best.index, length: best.length } : null;
}

function firstSubstantiveParagraphStart(text: string): number {
  const parts = text.split(/\n\n+/);
  let offset = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      offset += part.length + 2;
      continue;
    }
    const partStart = text.indexOf(trimmed, offset);
    const firstLine = trimmed.split("\n")[0]!.trim();
    if (!PREAMBLE_RE.some((re) => re.test(firstLine))) {
      return partStart === -1 ? offset : partStart;
    }
    offset = partStart + trimmed.length + 2;
  }
  return 0;
}

function buildExcerptWithSpans(
  text: string,
  needles: Array<{ needle: string; kind: HighlightSpan["kind"] }>,
  radius = 100,
): { excerpt: string; highlightSpans: HighlightSpan[] } {
  if (!text.trim()) return { excerpt: "", highlightSpans: [] };

  const anchor = findBestAnchor(text, needles);
  const anchorIndex = anchor?.index ?? firstSubstantiveParagraphStart(text);
  const anchorLength = anchor?.length ?? 0;

  let start = snapToSentenceStart(text, Math.max(0, anchorIndex - radius));
  let end = snapToSentenceEnd(text, Math.min(text.length, anchorIndex + anchorLength + radius));

  if (end - start < 90 && end < text.length) {
    end = snapToSentenceEnd(text, Math.min(text.length, end + 80));
  }

  let excerpt = text.slice(start, end).trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < text.length) excerpt = `${excerpt}…`;

  const highlightSpans: HighlightSpan[] = [];
  const excerptLower = excerpt.toLowerCase();

  for (const { needle, kind } of needles) {
    if (!needle) continue;
    const needleLower = needle.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < excerpt.length) {
      const at = excerptLower.indexOf(needleLower, searchFrom);
      if (at === -1) break;
      highlightSpans.push({ start: at, end: at + needle.length, kind });
      searchFrom = at + needle.length;
    }
  }

  return { excerpt, highlightSpans: mergeSpans(highlightSpans) };
}

function mergeSpans(spans: HighlightSpan[]): HighlightSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: HighlightSpan[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]!;
    const cur = sorted[i]!;
    if (cur.start <= prev.end) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

export function detectCitation(response: string, ctx: CitationContext): CitationResult {
  const text = response.trim();
  const promptText = ctx.promptText ?? "";

  if (!text) {
    return {
      cited: false,
      matchSignals: [],
      matchedUrl: null,
      excerpt: "",
      citationLayer: "none",
      whyCode: "uncited_no_mention",
      highlightSpans: [],
      competitors: [],
    };
  }

  const signals: string[] = [];
  let matchedUrl: string | null = null;
  const normalizedDomain = ctx.domain ? normalizeDomain(ctx.domain) : null;

  for (const rawUrl of extractUrls(text)) {
    try {
      const parsed = new URL(rawUrl);
      const host = normalizeDomain(parsed.hostname);
      const full = parsed.href.toLowerCase();

      if (normalizedDomain && (host === normalizedDomain || host.endsWith(`.${normalizedDomain}`))) {
        signals.push("domain_match");
        matchedUrl = rawUrl;
        break;
      }

      for (const productUrl of ctx.productUrls) {
        if (full.includes(productUrl.toLowerCase()) || productUrl.toLowerCase().includes(full)) {
          signals.push("url_match");
          matchedUrl = productUrl;
          break;
        }
        try {
          const productHost = normalizeDomain(new URL(productUrl).hostname);
          if (host === productHost && full.includes(new URL(productUrl).pathname.toLowerCase())) {
            signals.push("url_match");
            matchedUrl = productUrl;
            break;
          }
        } catch {
          /* skip */
        }
      }
      if (signals.length > 0) break;
    } catch {
      /* skip */
    }
  }

  if (signals.length === 0 && normalizedDomain && text.toLowerCase().includes(normalizedDomain)) {
    signals.push("domain_text_match");
    matchedUrl = `https://${normalizedDomain}`;
  }

  if (signals.length === 0 && ctx.storeName.trim().length >= 3) {
    if (brandMentioned(text, ctx.storeName)) {
      signals.push("brand_match");
    } else {
      const primaryToken = ctx.storeName.trim().split(/\s+/)[0] ?? "";
      if (primaryToken.length >= 4 && brandMentioned(text, primaryToken)) {
        signals.push("brand_token_match");
      }
    }
  }

  const cited = signals.length > 0;
  const citationLayer = cited ? citationLayerFromSignals(signals) : "none";
  const competitors = cited ? [] : extractCompetitors(text, ctx, normalizedDomain);
  const whyCode = whyCodeFromCitation(cited, citationLayer, competitors, promptText, ctx.storeName, text);

  const needles = findNeedles(text, ctx, normalizedDomain, matchedUrl, cited);
  const { excerpt, highlightSpans } = buildExcerptWithSpans(text, needles);

  return {
    cited,
    matchSignals: signals,
    matchedUrl,
    excerpt,
    citationLayer,
    whyCode,
    highlightSpans,
    competitors,
  };
}

export { citationLayerFromSignals, whyCodeFromCitation } from "./result-metadata.js";

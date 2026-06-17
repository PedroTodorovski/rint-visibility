export type CitationContext = {
  storeName: string;
  domain: string | null;
  productUrls: string[];
};

export type CitationResult = {
  cited: boolean;
  matchSignals: string[];
  matchedUrl: string | null;
  excerpt: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

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

function excerptAround(text: string, needle: string, radius = 80): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx === -1) {
    return text.slice(0, Math.min(text.length, radius * 2)).trim();
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  const slice = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`;
}

export function detectCitation(response: string, ctx: CitationContext): CitationResult {
  const text = response.trim();
  if (!text) {
    return { cited: false, matchSignals: [], matchedUrl: null, excerpt: "" };
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
          if (host === productHost) {
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
    const brand = ctx.storeName.trim();
    const brandRegex = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (brandRegex.test(text)) {
      signals.push("brand_match");
    }
  }

  const cited = signals.length > 0;
  const needle = matchedUrl ?? normalizedDomain ?? ctx.storeName;
  const excerpt = excerptAround(text, needle);

  return { cited, matchSignals: signals, matchedUrl, excerpt };
}

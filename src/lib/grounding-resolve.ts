import type { ResolvedGroundingUrl } from "./citation-gold.js";
import { normalizeHost } from "./citation-gold.js";

const REDIRECT_HOSTS = new Set(["vertexaisearch.cloud.google.com", "www.google.com", "google.com"]);
const RESOLVE_TIMEOUT_MS = 5_000;
const MAX_RESOLVE = 12;

function isGoogleRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (REDIRECT_HOSTS.has(host)) return true;
    return parsed.pathname.includes("grounding-api-redirect");
  } catch {
    return false;
  }
}

export async function resolveGroundingUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedGroundingUrl> {
  const from = url.trim();
  const directHost = (() => {
    try {
      return normalizeHost(new URL(from).hostname);
    } catch {
      return null;
    }
  })();

  if (!from || !isGoogleRedirect(from)) {
    return { from, to: from || null, host: directHost };
  }

  try {
    const response = await fetchImpl(from, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Rint-Visibility/1.0; +https://rint.io) AppleWebKit/537.36",
      },
    });
    const finalUrl = response.url?.trim() || from;
    const host = normalizeHost(new URL(finalUrl).hostname);
    if (host && isGoogleRedirect(finalUrl)) {
      return { from, to: finalUrl, host: null };
    }
    return { from, to: finalUrl, host };
  } catch {
    return { from, to: null, host: null };
  }
}

export async function resolveGroundingUrls(
  urls: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedGroundingUrl[]> {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, MAX_RESOLVE);
  return Promise.all(unique.map((url) => resolveGroundingUrl(url, fetchImpl)));
}

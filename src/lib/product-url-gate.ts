/**
 * Live product-URL gate — keep in sync with rint-app `src/lib/ui/product-url.ts`.
 * String compare only. Do not require `/products/`. Do not deny Facebook/OLX
 * or Mercado Livre / Amazon product pages. Login walls and search lists are not PDPs.
 */

const DENIED_PRODUCT_URL_HOSTS = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "tiktok.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "pinterest.com",
  "reddit.com",
  "wikipedia.org",
  "google.com",
  "google.com.br",
  "bing.com",
  "duckduckgo.com",
  "threads.net",
  "snapchat.com",
  "whatsapp.com",
  "telegram.org",
  "medium.com",
  "tumblr.com",
  "substack.com",
  "g1.globo.com",
  "uol.com.br",
  "folha.uol.com.br",
  "estadao.com.br",
  "terra.com.br",
  "bbc.com",
  "cnn.com",
  "healthline.com",
  "webmd.com",
] as const;

/** Listing / editorial paths — not a PDP. Do not match VTEX trailing `/p`. */
const DENIED_PRODUCT_URL_PATH_RE =
  /\/(collections?|colec(?:ao|oes|cion|ciones)|categor(?:y|ia|ias)|departamento|search|busca|pages?|blogs?|noticias?|news|artigos?|cart|carrinho|checkout|account(?:-verification)?|conta|login|gz)(\/|$)/i;

const MARKETPLACE_PRODUCT_HOSTS = [
  "mercadolivre.com.br",
  "mercadolivre.com",
  "mercadolibre.com",
  "mercadolibre.com.ar",
  "mercadolibre.com.mx",
  "amazon.com",
  "amazon.com.br",
  "amazon.co.uk",
  "amazon.de",
  "amzn.to",
] as const;

function isDeniedProductUrlHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (host.startsWith("lista.") && host.includes("mercadoli")) return true;
  return DENIED_PRODUCT_URL_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function isDeniedProductUrlPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return false;
  if (/^\/(products|produtos|produto)$/i.test(path)) return true;
  return DENIED_PRODUCT_URL_PATH_RE.test(path);
}

/** ML login (`/gz/account-verification?go=`) — use the destination, never the wall. */
export function unwrapMarketplaceLoginUrl(url: string): string {
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    const go = parsed.searchParams.get("go")?.trim();
    if (!go) return parsed.href;
    const path = parsed.pathname.toLowerCase();
    if (!path.includes("account-verification") && !path.split("/").includes("gz")) {
      return parsed.href;
    }
    return go.includes("://") ? go : decodeURIComponent(go);
  } catch {
    return url;
  }
}

/** Gemini pads fake MLB ids with zeros. A real item id is a short digit run. */
function isPlausibleMercadoLivreCatalogUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes("mercadoli")) return true;
  const match = url.pathname.match(/\bML[A-Z]{1,3}-?(\d{6,})\b/i);
  if (!match) return true;
  return match[1].length <= 12;
}

export function canonicalProductUrl(url: string | null | undefined): string | null {
  const href = url?.trim() || "";
  if (!href) return null;
  const dest = unwrapMarketplaceLoginUrl(href);
  return isLikelyPdpUrl(dest) ? dest : null;
}

export function isLikelyPdpUrl(url: string): boolean {
  try {
    const dest = unwrapMarketplaceLoginUrl(url);
    const parsed = new URL(dest.includes("://") ? dest : `https://${dest}`);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path) return false;
    if (isDeniedProductUrlHost(parsed.hostname)) return false;
    if (isDeniedProductUrlPath(parsed.pathname)) return false;
    if (!isPlausibleMercadoLivreCatalogUrl(parsed)) return false;
    return path.split("/").filter(Boolean).length >= 1;
  } catch {
    return false;
  }
}

/** Mercado Livre / Amazon — street-only. Not the “wrong Shopify” recado. */
export function isMarketplaceProductUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return MARKETPLACE_PRODUCT_HOSTS.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

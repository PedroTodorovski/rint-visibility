/** One HTTP profile for PDP GET, Google redirect, and public checkout JSON. */

export const OFFER_FETCH_TIMEOUT_MS = 8_000;

export const OFFER_FETCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function offerFetchHeaders(): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent": OFFER_FETCH_USER_AGENT,
    "Cache-Control": "no-cache",
  };
}

export function offerJsonHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent": OFFER_FETCH_USER_AGENT,
    "Cache-Control": "no-cache",
  };
}

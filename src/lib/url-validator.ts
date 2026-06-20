const DEFAULT_TIMEOUT_MS = 8_000;

export type UrlValidationResult = {
  url: string;
  alive: boolean;
  status: number | null;
};

export async function validateUrlAlive(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<UrlValidationResult> {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { url, alive: false, status: null };
    }

    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Rint-Visibility/1.0 (URL validation)" },
    });

    const alive = res.status >= 200 && res.status < 400;
    return { url, alive, status: res.status };
  } catch {
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "Rint-Visibility/1.0 (URL validation)" },
      });
      const alive = res.status >= 200 && res.status < 400;
      return { url, alive, status: res.status };
    } catch {
      return { url, alive: false, status: null };
    }
  }
}

export async function filterAliveUrls(urls: string[]): Promise<Map<string, UrlValidationResult>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const results = await Promise.all(unique.map((url) => validateUrlAlive(url)));
  return new Map(results.map((r) => [r.url, r]));
}

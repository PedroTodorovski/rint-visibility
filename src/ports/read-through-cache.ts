import type { PerRunReadCacheRepositoryLike } from "../repositories/per-run-read-cache.js";

export type CachedPortCall<T> = {
  data: T;
  cacheHit: boolean;
};

export async function readThroughCache<T>(
  cache: PerRunReadCacheRepositoryLike,
  probeRunId: string,
  portName: string,
  cacheKey: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<CachedPortCall<T>> {
  try {
    const cached = await cache.get(probeRunId, portName, cacheKey);
    if (cached) {
      return { data: cached.payload as T, cacheHit: true };
    }
  } catch {
    /* cache is optional — a miss must not fail the diagnostic */
  }

  const data = await fetcher();
  try {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await cache.set(probeRunId, portName, cacheKey, data, expiresAt);
  } catch {
    /* write-through is best-effort; the port read already succeeded */
  }
  return { data, cacheHit: false };
}

export const DEFAULT_PORT_TTL_MS = 60 * 60 * 1000;

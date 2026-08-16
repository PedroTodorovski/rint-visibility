import { describe, expect, it, vi } from "vitest";

import { readThroughCache } from "../src/ports/read-through-cache.js";
import type { PerRunReadCacheRepositoryLike } from "../src/repositories/per-run-read-cache.js";

function memoryCache(): PerRunReadCacheRepositoryLike & { writes: string[] } {
  const store = new Map<string, { payload: unknown; expires_at: string }>();
  const writes: string[] = [];
  return {
    writes,
    async get(probeRunId, portName, cacheKey) {
      const row = store.get(`${probeRunId}:${portName}:${cacheKey}`);
      if (!row || row.expires_at <= new Date().toISOString()) return null;
      return {
        id: "1",
        probe_run_id: probeRunId,
        port_name: portName,
        cache_key: cacheKey,
        payload: row.payload as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
        expires_at: row.expires_at,
      };
    },
    async set(probeRunId, portName, cacheKey, payload, expiresAt) {
      writes.push(probeRunId);
      store.set(`${probeRunId}:${portName}:${cacheKey}`, { payload, expires_at: expiresAt });
    },
  };
}

describe("readThroughCache", () => {
  it("keys cache rows by probe_run_id, not by an unrelated id", async () => {
    const cache = memoryCache();
    const probeRunId = "probe-run-1";
    await readThroughCache(cache, probeRunId, "shopify", "revenue", 60_000, async () => ({
      ok: true,
    }));
    expect(cache.writes).toEqual([probeRunId]);
    const second = await readThroughCache(
      cache,
      probeRunId,
      "shopify",
      "revenue",
      60_000,
      async () => {
        throw new Error("fetcher should not run on hit");
      },
    );
    expect(second.cacheHit).toBe(true);
    expect(second.data).toEqual({ ok: true });
  });

  it("does not fail the diagnostic when cache write hits a foreign key", async () => {
    const cache: PerRunReadCacheRepositoryLike = {
      async get() {
        return null;
      },
      async set() {
        throw new Error(
          'insert or update on table "per_run_read_cache" violates foreign key constraint "per_run_read_cache_probe_run_id_fkey"',
        );
      },
    };

    const result = await readThroughCache(
      cache,
      "job-not-a-probe-run",
      "ga4",
      "k",
      60_000,
      async () => ({
        totalRevenue: 10,
      }),
    );
    expect(result.cacheHit).toBe(false);
    expect(result.data).toEqual({ totalRevenue: 10 });
  });

  it("treats a cache read failure as a miss", async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }));
    const cache: PerRunReadCacheRepositoryLike = {
      async get() {
        throw new Error("Failed to read port cache");
      },
      async set() {
        /* ok */
      },
    };

    const result = await readThroughCache(cache, "probe-1", "meta", "k", 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.data).toEqual({ n: 1 });
  });
});

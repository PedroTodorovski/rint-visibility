import type { SupabaseClient } from "@supabase/supabase-js";

import { mapPostgrestError } from "./postgrest.js";

type VisibilityDb = SupabaseClient<any, "public", "rint">;

export type PerRunCacheRow = {
  id: string;
  probe_run_id: string;
  port_name: string;
  cache_key: string;
  payload: Record<string, unknown>;
  fetched_at: string;
  expires_at: string;
};

export type PerRunReadCacheRepositoryLike = {
  get(probeRunId: string, portName: string, cacheKey: string): Promise<PerRunCacheRow | null>;
  set(
    probeRunId: string,
    portName: string,
    cacheKey: string,
    payload: unknown,
    expiresAt: string,
  ): Promise<void>;
};

export class PerRunReadCacheRepository implements PerRunReadCacheRepositoryLike {
  constructor(private readonly db: VisibilityDb) {}

  async get(probeRunId: string, portName: string, cacheKey: string): Promise<PerRunCacheRow | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from("per_run_read_cache")
      .select("*")
      .eq("probe_run_id", probeRunId)
      .eq("port_name", portName)
      .eq("cache_key", cacheKey)
      .gt("expires_at", now)
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to read port cache");
    }

    return (data as PerRunCacheRow | null) ?? null;
  }

  async set(
    probeRunId: string,
    portName: string,
    cacheKey: string,
    payload: unknown,
    expiresAt: string,
  ): Promise<void> {
    const { error } = await this.db.from("per_run_read_cache").upsert(
      {
        probe_run_id: probeRunId,
        port_name: portName,
        cache_key: cacheKey,
        payload: payload as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: "probe_run_id,port_name,cache_key" },
    );

    if (error) {
      throw mapPostgrestError(error, "Failed to write port cache");
    }
  }
}

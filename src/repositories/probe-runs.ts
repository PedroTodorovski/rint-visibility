import type { SupabaseClient } from "@supabase/supabase-js";

import { mapPostgrestError } from "./postgrest.js";
import type { ProbeRunRow, ProbeRunStatus } from "./types.js";

type VisibilityDb = SupabaseClient<any, "public", "rint">;

export class ProbeRunsRepository {
  constructor(private readonly db: VisibilityDb) {}

  async create(storeId: string, scheduledFor: string): Promise<ProbeRunRow> {
    const { data, error } = await this.db
      .from("probe_runs")
      .insert({ store_id: storeId, status: "pending", scheduled_for: scheduledFor })
      .select("*")
      .single();

    if (error) throw mapPostgrestError(error, "Failed to create probe run");
    return data as ProbeRunRow;
  }

  async updateStatus(
    id: string,
    status: ProbeRunStatus,
    fields: { started_at?: string; completed_at?: string; error_message?: string } = {},
  ): Promise<ProbeRunRow> {
    const { data, error } = await this.db
      .from("probe_runs")
      .update({ status, ...fields })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw mapPostgrestError(error, "Failed to update probe run");
    return data as ProbeRunRow;
  }

  async findLatestByStoreId(storeId: string): Promise<ProbeRunRow | null> {
    const { data, error } = await this.db
      .from("probe_runs")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw mapPostgrestError(error, "Failed to load probe run");
    return data as ProbeRunRow | null;
  }
}

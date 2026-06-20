import type { SupabaseClient } from "@supabase/supabase-js";

import { mapPostgrestError } from "./postgrest.js";
import type { RevenueGapAssumptions, RevenueGapFlags } from "../services/revenue-gap-engine.js";

type VisibilityDb = SupabaseClient<any, "public", "rint">;

export type LacunaSnapshotRow = {
  id: string;
  probe_run_id: string;
  store_id: string;
  lacuna_rs: number;
  clientes_perdidos: number;
  custo_compensar: number;
  assumptions: RevenueGapAssumptions;
  flags: RevenueGapFlags;
  created_at: string;
};

export type CreateLacunaSnapshotInput = {
  probe_run_id: string;
  store_id: string;
  lacuna_rs: number;
  clientes_perdidos: number;
  custo_compensar: number;
  assumptions: RevenueGapAssumptions;
  flags: RevenueGapFlags;
};

export type LacunaSnapshotsRepositoryLike = {
  create(input: CreateLacunaSnapshotInput): Promise<LacunaSnapshotRow>;
  findLatestByStoreId(storeId: string): Promise<LacunaSnapshotRow | null>;
  findByProbeRunId(probeRunId: string): Promise<LacunaSnapshotRow | null>;
};

export class LacunaSnapshotsRepository implements LacunaSnapshotsRepositoryLike {
  constructor(private readonly db: VisibilityDb) {}

  async create(input: CreateLacunaSnapshotInput): Promise<LacunaSnapshotRow> {
    const { data, error } = await this.db
      .from("lacuna_snapshots")
      .insert({
        probe_run_id: input.probe_run_id,
        store_id: input.store_id,
        lacuna_rs: input.lacuna_rs,
        clientes_perdidos: input.clientes_perdidos,
        custo_compensar: input.custo_compensar,
        assumptions: input.assumptions,
        flags: input.flags,
      })
      .select("*")
      .single();

    if (error) {
      throw mapPostgrestError(error, "Failed to create lacuna snapshot");
    }

    return data as LacunaSnapshotRow;
  }

  async findLatestByStoreId(storeId: string): Promise<LacunaSnapshotRow | null> {
    const { data, error } = await this.db
      .from("lacuna_snapshots")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to fetch lacuna snapshot");
    }

    return (data as LacunaSnapshotRow | null) ?? null;
  }

  async findByProbeRunId(probeRunId: string): Promise<LacunaSnapshotRow | null> {
    const { data, error } = await this.db
      .from("lacuna_snapshots")
      .select("*")
      .eq("probe_run_id", probeRunId)
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to fetch lacuna snapshot by run");
    }

    return (data as LacunaSnapshotRow | null) ?? null;
  }
}

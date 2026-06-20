import type { SupabaseClient } from "@supabase/supabase-js";

import { mapPostgrestError } from "./postgrest.js";
import type { DualTrackItem } from "../services/dual-track-generator.js";
import type { TriageOwner } from "../services/dual-track-generator.js";

type VisibilityDb = SupabaseClient<any, "public", "rint">;

export type DualTrackOutputRow = {
  id: string;
  probe_run_id: string;
  sku_ref_id: string | null;
  track_number: number;
  items: DualTrackItem[];
  triage_owner: TriageOwner | null;
  created_at: string;
};

export type CreateDualTrackInput = {
  probe_run_id: string;
  sku_ref_id: string | null;
  track_number: 1 | 2;
  items: DualTrackItem[];
  triage_owner: TriageOwner;
};

export type DualTrackOutputsRepositoryLike = {
  createMany(inputs: CreateDualTrackInput[]): Promise<DualTrackOutputRow[]>;
  listByProbeRunId(probeRunId: string): Promise<DualTrackOutputRow[]>;
};

export class DualTrackOutputsRepository implements DualTrackOutputsRepositoryLike {
  constructor(private readonly db: VisibilityDb) {}

  async createMany(inputs: CreateDualTrackInput[]): Promise<DualTrackOutputRow[]> {
    if (inputs.length === 0) return [];

    const { data, error } = await this.db
      .from("dual_track_outputs")
      .insert(
        inputs.map((input) => ({
          probe_run_id: input.probe_run_id,
          sku_ref_id: input.sku_ref_id,
          track_number: input.track_number,
          items: input.items,
          triage_owner: input.triage_owner,
        })),
      )
      .select("*");

    if (error) {
      throw mapPostgrestError(error, "Failed to create dual track outputs");
    }

    return (data ?? []) as DualTrackOutputRow[];
  }

  async listByProbeRunId(probeRunId: string): Promise<DualTrackOutputRow[]> {
    const { data, error } = await this.db
      .from("dual_track_outputs")
      .select("*")
      .eq("probe_run_id", probeRunId)
      .order("track_number", { ascending: true });

    if (error) {
      throw mapPostgrestError(error, "Failed to list dual track outputs");
    }

    return (data ?? []) as DualTrackOutputRow[];
  }
}

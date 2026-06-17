import type { SupabaseClient } from "@supabase/supabase-js";

import { mapPostgrestError } from "./postgrest.js";
import type { CatalogFix, WeeklyScoreRow } from "./types.js";

type VisibilityDb = SupabaseClient<any, "public", "rint">;

export type UpsertWeeklyScoreInput = {
  store_id: string;
  probe_run_id: string;
  week_start: string;
  prompts_total: number;
  citation_slots_total: number;
  citations_count: number;
  score_pct: number;
  fixes: CatalogFix[];
};

export class WeeklyScoresRepository {
  constructor(private readonly db: VisibilityDb) {}

  async upsert(input: UpsertWeeklyScoreInput): Promise<WeeklyScoreRow> {
    const { data, error } = await this.db
      .from("weekly_scores")
      .upsert(
        {
          store_id: input.store_id,
          probe_run_id: input.probe_run_id,
          week_start: input.week_start,
          prompts_total: input.prompts_total,
          citation_slots_total: input.citation_slots_total,
          citations_count: input.citations_count,
          score_pct: input.score_pct,
          fixes: input.fixes,
        },
        { onConflict: "store_id,week_start" },
      )
      .select("*")
      .single();

    if (error) throw mapPostgrestError(error, "Failed to save weekly score");
    return data as WeeklyScoreRow;
  }

  async findLatestByStoreId(storeId: string): Promise<WeeklyScoreRow | null> {
    const { data, error } = await this.db
      .from("weekly_scores")
      .select("*")
      .eq("store_id", storeId)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw mapPostgrestError(error, "Failed to load weekly score");
    return data as WeeklyScoreRow | null;
  }
}

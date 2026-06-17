import type { SupabaseClient } from "@supabase/supabase-js";

import { mapPostgrestError } from "./postgrest.js";
import type { ResultProvider, ResultRow, ResultWithPrompt } from "./types.js";

type VisibilityDb = SupabaseClient<any, "public", "rint">;

export type CreateResultInput = {
  probe_run_id: string;
  prompt_id: string;
  provider: ResultProvider;
  cited: boolean;
  response_excerpt: string | null;
  metadata: Record<string, unknown>;
};

export class ResultsRepository {
  constructor(private readonly db: VisibilityDb) {}

  async createMany(inputs: CreateResultInput[]): Promise<ResultRow[]> {
    if (inputs.length === 0) return [];

    const { data, error } = await this.db.from("results").insert(inputs).select("*");

    if (error) throw mapPostgrestError(error, "Failed to save probe results");
    return (data ?? []) as ResultRow[];
  }

  async listByStoreId(
    storeId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<ResultWithPrompt[]> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const { data: runs, error: runsError } = await this.db
      .from("probe_runs")
      .select("id, completed_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });

    if (runsError) throw mapPostgrestError(runsError, "Failed to load probe runs");

    const runIds = (runs ?? []).map((r) => r.id as string);
    if (runIds.length === 0) return [];

    const { data: results, error: resultsError } = await this.db
      .from("results")
      .select("*")
      .in("probe_run_id", runIds)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (resultsError) throw mapPostgrestError(resultsError, "Failed to load results");

    const promptIds = [...new Set((results ?? []).map((r) => r.prompt_id as string))];
    const { data: prompts, error: promptsError } = await this.db
      .from("prompts")
      .select("id, prompt_text")
      .in("id", promptIds);

    if (promptsError) throw mapPostgrestError(promptsError, "Failed to load prompts");

    const promptMap = new Map((prompts ?? []).map((p) => [p.id as string, p.prompt_text as string]));
    const runCompleted = new Map((runs ?? []).map((r) => [r.id as string, r.completed_at as string | null]));

    return (results ?? []).map((row) => ({
      ...(row as ResultRow),
      prompt_text: promptMap.get(row.prompt_id as string) ?? "",
      probe_completed_at: runCompleted.get(row.probe_run_id as string) ?? null,
    }));
  }
}

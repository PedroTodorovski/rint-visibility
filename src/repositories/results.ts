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
    options: { limit?: number; offset?: number; probeRunId?: string } = {},
  ): Promise<ResultWithPrompt[]> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const { data: runs, error: runsError } = await this.db
      .from("probe_runs")
      .select("id, completed_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });

    if (runsError) throw mapPostgrestError(runsError, "Failed to load probe runs");

    let runIds = (runs ?? []).map((r) => r.id as string);
    if (options.probeRunId) {
      runIds = runIds.filter((id) => id === options.probeRunId);
    }
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

  async listByProbeRunId(storeId: string, probeRunId: string): Promise<ResultWithPrompt[]> {
    const run = await this.db
      .from("probe_runs")
      .select("id, completed_at")
      .eq("store_id", storeId)
      .eq("id", probeRunId)
      .maybeSingle();

    if (run.error) throw mapPostgrestError(run.error, "Failed to load probe run");
    if (!run.data) return [];

    const { data: results, error: resultsError } = await this.db
      .from("results")
      .select("*")
      .eq("probe_run_id", probeRunId)
      .order("created_at", { ascending: true });

    if (resultsError) throw mapPostgrestError(resultsError, "Failed to load results");

    const promptIds = [...new Set((results ?? []).map((r) => r.prompt_id as string))];
    const { data: prompts, error: promptsError } = await this.db
      .from("prompts")
      .select("id, prompt_text")
      .in("id", promptIds);

    if (promptsError) throw mapPostgrestError(promptsError, "Failed to load prompts");

    const promptMap = new Map((prompts ?? []).map((p) => [p.id as string, p.prompt_text as string]));
    const completedAt = run.data.completed_at as string | null;

    return (results ?? []).map((row) => ({
      ...(row as ResultRow),
      prompt_text: promptMap.get(row.prompt_id as string) ?? "",
      probe_completed_at: completedAt,
    }));
  }

  async countByProbeRunIds(probeRunIds: string[]): Promise<Map<string, { cited: number; total: number }>> {
    const counts = new Map<string, { cited: number; total: number }>();
    if (probeRunIds.length === 0) return counts;

    const { data, error } = await this.db
      .from("results")
      .select("probe_run_id, cited")
      .in("probe_run_id", probeRunIds);

    if (error) throw mapPostgrestError(error, "Failed to count results");

    for (const row of data ?? []) {
      const runId = row.probe_run_id as string;
      const entry = counts.get(runId) ?? { cited: 0, total: 0 };
      entry.total += 1;
      if (row.cited) entry.cited += 1;
      counts.set(runId, entry);
    }

    return counts;
  }
}

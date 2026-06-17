import type { SupabaseClient } from "@supabase/supabase-js";

import { limitExceeded, notFound } from "../lib/errors.js";
import { mapPostgrestError } from "./postgrest.js";
import type { CreatePromptInput, PromptRow, UpdatePromptInput } from "./types.js";
import { MAX_PROMPTS_PER_STORE } from "./types.js";

type VisibilityDb = SupabaseClient<any, "public", "rint">;

export class PromptsRepository {
  constructor(private readonly db: VisibilityDb) {}

  async listByStoreId(storeId: string): Promise<PromptRow[]> {
    const { data, error } = await this.db
      .from("prompts")
      .select("*")
      .eq("store_id", storeId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      throw mapPostgrestError(error, "Failed to list prompts");
    }

    return (data ?? []) as PromptRow[];
  }

  async create(storeId: string, input: CreatePromptInput): Promise<PromptRow> {
    const existing = await this.listByStoreId(storeId);
    if (existing.length >= MAX_PROMPTS_PER_STORE) {
      throw limitExceeded(`Store already has the maximum of ${MAX_PROMPTS_PER_STORE} prompts`);
    }

    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from("prompts")
      .insert({
        store_id: storeId,
        prompt_text: input.prompt_text,
        active: input.active ?? true,
        sort_order: input.sort_order ?? 0,
        updated_at: now,
      })
      .select("*")
      .single();

    if (error) {
      throw mapPostgrestError(error, "Failed to create prompt");
    }

    return data as PromptRow;
  }

  async update(storeId: string, promptId: string, input: UpdatePromptInput): Promise<PromptRow> {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.prompt_text !== undefined) patch.prompt_text = input.prompt_text;
    if (input.active !== undefined) patch.active = input.active;
    if (input.sort_order !== undefined) patch.sort_order = input.sort_order;

    const { data, error } = await this.db
      .from("prompts")
      .update(patch)
      .eq("id", promptId)
      .eq("store_id", storeId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to update prompt");
    }

    if (!data) {
      throw notFound(`Prompt ${promptId} not found`);
    }

    return data as PromptRow;
  }

  async delete(storeId: string, promptId: string): Promise<void> {
    const { data, error } = await this.db
      .from("prompts")
      .delete()
      .eq("id", promptId)
      .eq("store_id", storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to delete prompt");
    }

    if (!data) {
      throw notFound(`Prompt ${promptId} not found`);
    }
  }
}

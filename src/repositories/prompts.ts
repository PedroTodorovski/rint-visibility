import type { SupabaseClient } from "@supabase/supabase-js";

import { limitExceeded, notFound } from "../lib/errors.js";
import { mapPostgrestError } from "./postgrest.js";
import type { CreatePromptInput, PromptRow, UpdatePromptInput } from "./types.js";
import { MAX_PROMPTS_PER_PRODUCT, MAX_PROMPTS_PER_STORE } from "./types.js";

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

  async countActiveByProductId(storeId: string, productId: string): Promise<number> {
    const { count, error } = await this.db
      .from("prompts")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("product_id", productId)
      .eq("active", true);

    if (error) {
      throw mapPostgrestError(error, "Failed to count prompts for product");
    }

    return count ?? 0;
  }

  async create(storeId: string, input: CreatePromptInput): Promise<PromptRow> {
    const existing = await this.listByStoreId(storeId);
    if (existing.length >= MAX_PROMPTS_PER_STORE) {
      throw limitExceeded(`Store already has the maximum of ${MAX_PROMPTS_PER_STORE} prompts`);
    }

    if (input.product_id) {
      const activeForProduct = await this.countActiveByProductId(
        storeId,
        input.product_id,
      );
      const willBeActive = input.active ?? true;
      if (willBeActive && activeForProduct >= MAX_PROMPTS_PER_PRODUCT) {
        throw limitExceeded(
          `Product already has the maximum of ${MAX_PROMPTS_PER_PRODUCT} active prompts`,
        );
      }
    }

    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from("prompts")
      .insert({
        store_id: storeId,
        product_id: input.product_id ?? null,
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
    if (input.product_id !== undefined && input.product_id !== null) {
      const activeForProduct = await this.countActiveByProductId(storeId, input.product_id);
      const willBeActive = input.active ?? true;
      if (willBeActive && activeForProduct >= MAX_PROMPTS_PER_PRODUCT) {
        throw limitExceeded(
          `Product already has the maximum of ${MAX_PROMPTS_PER_PRODUCT} active prompts`,
        );
      }
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.prompt_text !== undefined) patch.prompt_text = input.prompt_text;
    if (input.product_id !== undefined) patch.product_id = input.product_id;
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

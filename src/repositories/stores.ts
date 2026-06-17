import type { SupabaseClient } from "@supabase/supabase-js";

import { notFound } from "../lib/errors.js";
import { mapPostgrestError } from "./postgrest.js";
import type { StoreRow, UpsertStoreInput } from "./types.js";

type VisibilityDb = SupabaseClient<any, "public", "rint">;

export class StoresRepository {
  constructor(private readonly db: VisibilityDb) {}

  async findByWorkspaceId(workspaceId: string): Promise<StoreRow | null> {
    const { data, error } = await this.db
      .from("stores")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to load store");
    }

    return data as StoreRow | null;
  }

  async requireByWorkspaceId(workspaceId: string): Promise<StoreRow> {
    const store = await this.findByWorkspaceId(workspaceId);
    if (!store) {
      throw notFound(`Store not found for workspace ${workspaceId}`);
    }
    return store;
  }

  async upsert(workspaceId: string, input: UpsertStoreInput): Promise<StoreRow> {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from("stores")
      .upsert(
        {
          workspace_id: workspaceId,
          name: input.name,
          domain: input.domain ?? null,
          locale: input.locale ?? "en",
          status: input.status ?? "active",
          updated_at: now,
        },
        { onConflict: "workspace_id" },
      )
      .select("*")
      .single();

    if (error) {
      throw mapPostgrestError(error, "Failed to upsert store");
    }

    return data as StoreRow;
  }
}

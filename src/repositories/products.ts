import type { SupabaseClient } from "@supabase/supabase-js";

import { limitExceeded, notFound } from "../lib/errors.js";
import { mapPostgrestError } from "./postgrest.js";
import type {
  CreateProductInput,
  ProductRow,
  UpdateProductInput,
} from "./types.js";
import { MAX_PRODUCTS_PER_STORE as MAX_PRODUCTS } from "./types.js";

type VisibilityDb = SupabaseClient<any, "public", "rint">;

export class ProductsRepository {
  constructor(private readonly db: VisibilityDb) {}

  async listByStoreId(storeId: string): Promise<ProductRow[]> {
    const { data, error } = await this.db
      .from("products")
      .select("*")
      .eq("store_id", storeId)
      .order("position", { ascending: true });

    if (error) {
      throw mapPostgrestError(error, "Failed to list products");
    }

    return (data ?? []) as ProductRow[];
  }

  async create(storeId: string, input: CreateProductInput): Promise<ProductRow> {
    const existing = await this.listByStoreId(storeId);
    if (existing.length >= MAX_PRODUCTS) {
      throw limitExceeded(`Store already has the maximum of ${MAX_PRODUCTS} hero products`);
    }

    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from("products")
      .insert({
        store_id: storeId,
        url: input.url,
        title: input.title ?? null,
        description: input.description ?? null,
        external_ref: input.external_ref ?? null,
        position: input.position,
        updated_at: now,
      })
      .select("*")
      .single();

    if (error) {
      throw mapPostgrestError(error, "Failed to create product");
    }

    return data as ProductRow;
  }

  async update(storeId: string, productId: string, input: UpdateProductInput): Promise<ProductRow> {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.url !== undefined) patch.url = input.url;
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.external_ref !== undefined) patch.external_ref = input.external_ref;
    if (input.position !== undefined) patch.position = input.position;

    const { data, error } = await this.db
      .from("products")
      .update(patch)
      .eq("id", productId)
      .eq("store_id", storeId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to update product");
    }

    if (!data) {
      throw notFound(`Product ${productId} not found`);
    }

    return data as ProductRow;
  }

  async delete(storeId: string, productId: string): Promise<void> {
    const { data, error } = await this.db
      .from("products")
      .delete()
      .eq("id", productId)
      .eq("store_id", storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "Failed to delete product");
    }

    if (!data) {
      throw notFound(`Product ${productId} not found`);
    }
  }
}

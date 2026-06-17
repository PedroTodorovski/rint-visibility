export type StoreStatus = "active" | "paused";

export type StoreRow = {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  locale: string;
  status: StoreStatus;
  created_at: string;
  updated_at: string;
};

export type ProductRow = {
  id: string;
  store_id: string;
  url: string;
  title: string | null;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type PromptRow = {
  id: string;
  store_id: string;
  prompt_text: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type UpsertStoreInput = {
  name: string;
  domain?: string | null;
  locale?: string;
  status?: StoreStatus;
};

export type CreateProductInput = {
  url: string;
  title?: string | null;
  description?: string | null;
  position: number;
};

export type UpdateProductInput = {
  url?: string;
  title?: string | null;
  description?: string | null;
  position?: number;
};

export type CreatePromptInput = {
  prompt_text: string;
  active?: boolean;
  sort_order?: number;
};

export type UpdatePromptInput = {
  prompt_text?: string;
  active?: boolean;
  sort_order?: number;
};

export const MAX_PRODUCTS_PER_STORE = 3;
export const MAX_PROMPTS_PER_STORE = 10;

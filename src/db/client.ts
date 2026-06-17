import { createClient } from "@supabase/supabase-js";

import type { AppConfig } from "../config.js";

export function createSupabaseClient(config: AppConfig) {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("Supabase credentials are not configured");
  }

  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    db: { schema: "rint" },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

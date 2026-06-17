import { describe, expect, it } from "vitest";

import { buildDatabaseUrl, isDirectSupabaseDatabaseHost, resolveSupabaseDbUrl, selectPoolerConfig } from "../../scripts/db/resolve-supabase-db-url.mjs";

const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;

describe("resolve-supabase-db-url", () => {
  it("selects the primary session pooler config", () => {
    const selected = selectPoolerConfig([
      {
        database_type: "PRIMARY",
        db_user: "postgres.project-ref",
        db_host: "aws-1-sa-east-1.pooler.supabase.com",
        db_port: 6543,
        db_name: "postgres",
        pool_mode: "transaction",
      },
      {
        database_type: "PRIMARY",
        db_user: "postgres.project-ref",
        db_host: "aws-1-sa-east-1.pooler.supabase.com",
        db_port: 5432,
        db_name: "postgres",
        pool_mode: "session",
      },
    ]);

    expect(selected.db_port).toBe(5432);
    expect(selected.pool_mode).toBe("session");
  });

  it("infers session pooler on port 5432 when only transaction metadata is available", () => {
    const selected = selectPoolerConfig([
      {
        database_type: "PRIMARY",
        db_user: "postgres.project-ref",
        db_host: "aws-1-sa-east-1.pooler.supabase.com",
        db_port: 6543,
        db_name: "postgres",
        pool_mode: "transaction",
      },
    ]);

    expect(selected.db_port).toBe(5432);
    expect(selected.pool_mode).toBe("session");
    expect(selected.inferred_from).toBe("transaction_pooler_metadata");
  });

  it("uses an explicit session pooler URL when provided", async () => {
    const result = await resolveSupabaseDbUrl({
      env: env({
        SUPABASE_ACCESS_TOKEN: "token",
        SUPABASE_PROJECT_REF: "project-ref",
        SUPABASE_DB_PASSWORD: "abc@123",
        SUPABASE_DB_URL: "postgresql://postgres.project-ref:[YOUR-PASSWORD]@aws-1-sa-east-1.pooler.supabase.com:5432/postgres",
      }),
      fetchImpl: async () => {
        throw new Error("fetch should not be called when SUPABASE_DB_URL is provided");
      },
    });

    expect(result.databaseUrl).toBe(
      "postgresql://postgres.project-ref:abc%40123@aws-1-sa-east-1.pooler.supabase.com:5432/postgres",
    );
    expect(result.safeConfig.poolMode).toBe("session");
    expect(result.safeConfig.source).toBe("SUPABASE_DB_URL");
    expect(result.safeConfig.passwordSource).toBe("SUPABASE_DB_PASSWORD");
  });

  it("builds a percent-encoded database URL from a raw password", () => {
    const url = buildDatabaseUrl(
      {
        db_user: "postgres.project-ref",
        db_host: "aws-1-sa-east-1.pooler.supabase.com",
        db_port: 5432,
        db_name: "postgres",
      },
      "abc@123#x/y%z",
      "project-ref",
    );

    expect(url).toBe(
      "postgresql://postgres.project-ref:abc%40123%23x%2Fy%25z@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require",
    );
  });

  it("detects direct Supabase database hosts", () => {
    expect(isDirectSupabaseDatabaseHost("db.project-ref.supabase.co")).toBe(true);
    expect(isDirectSupabaseDatabaseHost("aws-1-sa-east-1.pooler.supabase.com")).toBe(false);
  });

  it("bypasses direct database URLs and resolves the session pooler for CI", async () => {
    const result = await resolveSupabaseDbUrl({
      env: env({
        SUPABASE_ACCESS_TOKEN: "token",
        SUPABASE_PROJECT_REF: "project-ref",
        SUPABASE_DB_PASSWORD: "abc@123",
        SUPABASE_DB_URL: "postgresql://postgres:placeholder@db.project-ref.supabase.co:5432/postgres",
      }),
      fetchImpl: async () =>
        Response.json([
          {
            database_type: "PRIMARY",
            identifier: "project-ref",
            db_user: "postgres",
            db_host: "aws-1-sa-east-1.pooler.supabase.com",
            db_port: 5432,
            db_name: "postgres",
            pool_mode: "session",
          },
        ]),
    });

    expect(result.databaseUrl).toBe(
      "postgresql://postgres.project-ref:abc%40123@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require",
    );
    expect(result.safeConfig.host).toBe("aws-1-sa-east-1.pooler.supabase.com");
    expect(result.safeConfig.source).toContain("direct db host bypassed");
  });

  it("bypasses direct host and infers session port when API returns only transaction pooler", async () => {
    const result = await resolveSupabaseDbUrl({
      env: env({
        SUPABASE_ACCESS_TOKEN: "token",
        SUPABASE_PROJECT_REF: "project-ref",
        SUPABASE_DB_PASSWORD: "abc@123",
        SUPABASE_DB_URL: "postgresql://postgres:placeholder@db.project-ref.supabase.co:5432/postgres",
      }),
      fetchImpl: async () =>
        Response.json([
          {
            database_type: "PRIMARY",
            identifier: "project-ref",
            db_user: "postgres",
            db_host: "aws-1-sa-east-1.pooler.supabase.com",
            db_port: 6543,
            db_name: "postgres",
            pool_mode: "transaction",
          },
        ]),
    });

    expect(result.databaseUrl).toBe(
      "postgresql://postgres.project-ref:abc%40123@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require",
    );
    expect(result.safeConfig.poolMode).toBe("session");
  });

  it("rewrites explicit transaction pooler URLs to session port 5432", async () => {
    const result = await resolveSupabaseDbUrl({
      env: env({
        SUPABASE_ACCESS_TOKEN: "token",
        SUPABASE_PROJECT_REF: "project-ref",
        SUPABASE_DB_PASSWORD: "abc@123",
        SUPABASE_DB_URL:
          "postgresql://postgres.project-ref:secret@aws-1-sa-east-1.pooler.supabase.com:6543/postgres",
      }),
      fetchImpl: async () => {
        throw new Error("fetch should not be called when SUPABASE_DB_URL is provided");
      },
    });

    expect(result.databaseUrl).toBe(
      "postgresql://postgres.project-ref:secret@aws-1-sa-east-1.pooler.supabase.com:5432/postgres",
    );
    expect(result.safeConfig.poolMode).toBe("session");
  });
});

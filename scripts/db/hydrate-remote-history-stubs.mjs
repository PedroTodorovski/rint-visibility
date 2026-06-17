#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MIGRATION_FILE_PATTERN = /^(\d{14})_[a-z0-9_]+\.sql$/;
const MIGRATION_LIST_MAX_ATTEMPTS = readPositiveIntegerEnv("SUPABASE_MIGRATION_LIST_MAX_ATTEMPTS", 5);
const MIGRATION_LIST_RETRY_BASE_DELAY_MS = readPositiveIntegerEnv(
  "SUPABASE_MIGRATION_LIST_RETRY_BASE_DELAY_MS",
  5000,
);

const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const databaseUrl = process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  console.error("Missing required environment variable: SUPABASE_DB_URL");
  process.exit(1);
}

if (!existsSync(migrationsDir)) {
  console.error("Missing supabase/migrations directory.");
  process.exit(1);
}

const localVersions = new Set(
  readdirSync(migrationsDir)
    .map((fileName) => fileName.match(MIGRATION_FILE_PATTERN)?.[1])
    .filter(Boolean),
);

const migrationListOutput = runSupabaseMigrationList(databaseUrl);
const remoteVersions = new Set([...migrationListOutput.matchAll(/\b\d{14}\b/g)].map((match) => match[0]));
const missingRemoteVersions = [...remoteVersions]
  .filter((version) => !localVersions.has(version))
  .sort();

if (missingRemoteVersions.length === 0) {
  console.log("No external remote migration history stubs needed.");
  process.exit(0);
}

mkdirSync(migrationsDir, { recursive: true });

for (const version of missingRemoteVersions) {
  const filePath = path.join(migrationsDir, `${version}_external_remote_history.sql`);

  writeFileSync(
    filePath,
    [
      "-- rint:external-migration-history-stub",
      "-- objective: represent a migration already applied in the shared Supabase database by another repository",
      "-- risk: none",
      "-- rollback: remove this generated runner-only file; do not mark external shared-history migrations as reverted from this repo",
      "",
      "-- This file is generated inside GitHub Actions only.",
      "-- It lets Supabase CLI validate shared migration history while this repository",
      "-- owns only rint-specific migrations under supabase/migrations/.",
      "",
    ].join("\n"),
    "utf8",
  );
}

console.log(`Hydrated ${missingRemoteVersions.length} external remote migration history stub(s).`);

function runSupabaseMigrationList(dbUrl) {
  const commandEnv = {
    ...process.env,
    PGSSLMODE: process.env.PGSSLMODE || "require",
    PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || "30",
  };

  for (let attempt = 1; attempt <= MIGRATION_LIST_MAX_ATTEMPTS; attempt += 1) {
    try {
      return execFileSync("supabase", ["migration", "list", "--db-url", dbUrl], {
        encoding: "utf8",
        env: commandEnv,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch (error) {
      const shouldRetry = attempt < MIGRATION_LIST_MAX_ATTEMPTS && isTransientSupabaseConnectionError(error);

      if (!shouldRetry) {
        writeCommandOutput(error);
        throw error;
      }

      console.warn(
        [
          `Supabase migration history read failed with a transient connection error (${attempt}/${MIGRATION_LIST_MAX_ATTEMPTS}).`,
          `Retrying in ${formatMilliseconds(nextRetryDelayMs(attempt))}...`,
        ].join(" "),
      );
      sleep(nextRetryDelayMs(attempt));
    }
  }
}

function isTransientSupabaseConnectionError(error) {
  const output = getCommandText(error).toLowerCase();

  return [
    "echeckouttimeout",
    "failed to connect",
    "failed to receive message",
    "context deadline exceeded",
    "connection refused",
    "connection reset",
    "connection terminated",
    "i/o timeout",
    "network is unreachable",
    "temporary failure",
    "no such host",
    "server closed the connection",
    "timeout",
    "pooler",
  ].some((fragment) => output.includes(fragment));
}

function writeCommandOutput(error) {
  const stdout = normalizeCommandText(error?.stdout);
  const stderr = normalizeCommandText(error?.stderr);

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
}

function getCommandText(error) {
  return [
    normalizeCommandText(error?.stdout),
    normalizeCommandText(error?.stderr),
    normalizeCommandText(error?.message),
  ].join("\n");
}

function normalizeCommandText(value) {
  if (!value) {
    return "";
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  return String(value);
}

function nextRetryDelayMs(attempt) {
  return MIGRATION_LIST_RETRY_BASE_DELAY_MS * attempt;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function formatMilliseconds(milliseconds) {
  return `${Math.round(milliseconds / 1000)}s`;
}

function readPositiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

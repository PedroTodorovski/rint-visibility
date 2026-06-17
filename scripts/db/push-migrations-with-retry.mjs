#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const databaseUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.SUPABASE_DB_PUSH_DRY_RUN === "true";
const MAX_ATTEMPTS = readPositiveIntegerEnv("SUPABASE_DB_PUSH_MAX_ATTEMPTS", 4);
const RETRY_BASE_DELAY_MS = readPositiveIntegerEnv("SUPABASE_DB_PUSH_RETRY_BASE_DELAY_MS", 8000);
const COMMAND_TIMEOUT_MS = readPositiveIntegerEnv("SUPABASE_DB_PUSH_TIMEOUT_MS", 900_000);

if (!databaseUrl) {
  console.error("Missing required secret SUPABASE_DB_URL.");
  console.error("Use a Postgres connection string reachable from GitHub Actions, such as the Supabase Session Pooler.");
  process.exit(1);
}

const args = ["--yes", "db", "push", "--include-all", "--db-url", databaseUrl];

if (dryRun) {
  args.splice(4, 0, "--dry-run");
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  console.log(`Running migration push attempt ${attempt}/${MAX_ATTEMPTS}${dryRun ? " (dry-run)" : ""}...`);

  const result = spawnSync("supabase", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      PGSSLMODE: process.env.PGSSLMODE || "require",
      PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || "30",
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
  });

  writeCommandOutput(result);

  if (result.status === 0) {
    console.log(`Migration push succeeded on attempt ${attempt}.`);
    process.exit(0);
  }

  const shouldRetry = attempt < MAX_ATTEMPTS && isTransientSupabaseConnectionResult(result);

  if (!shouldRetry) {
    process.exit(result.status ?? 1);
  }

  const delayMs = nextRetryDelayMs(attempt);
  console.warn(
    [
      `Supabase migration push failed with a transient connection error (${attempt}/${MAX_ATTEMPTS}).`,
      `Retrying in ${formatMilliseconds(delayMs)}...`,
    ].join(" "),
  );
  sleep(delayMs);
}

function isTransientSupabaseConnectionResult(result) {
  const output = getCommandText(result).toLowerCase();

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

function writeCommandOutput(result) {
  const stdout = normalizeCommandText(result.stdout);
  const stderr = normalizeCommandText(result.stderr);
  const errorMessage = normalizeCommandText(result.error?.message);

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
  if (errorMessage) {
    process.stderr.write(`${errorMessage}\n`);
  }
}

function getCommandText(result) {
  return [
    normalizeCommandText(result.stdout),
    normalizeCommandText(result.stderr),
    normalizeCommandText(result.error?.message),
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
  return RETRY_BASE_DELAY_MS * attempt;
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

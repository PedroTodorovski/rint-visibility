#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const baseRef = process.env.BASE_REF;

if (!baseRef) {
  console.log("db:history guard skipped: BASE_REF not provided");
  process.exit(0);
}

let diffRange = `${baseRef}...HEAD`;

try {
  execFileSync("git", ["merge-base", baseRef, "HEAD"], { stdio: "ignore" });
} catch {
  console.warn(`db:history guard warning: no merge base for ${baseRef}; falling back to tree diff`);
  diffRange = `${baseRef}..HEAD`;
}

const diff = execFileSync("git", ["diff", "--name-status", diffRange, "--", "supabase/migrations"], {
  encoding: "utf8",
});

const lines = diff
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const blocked = lines.filter((line) => {
  if (!/^(M|D|R)/.test(line)) {
    return false;
  }

  const parts = line.split(/\s+/);
  const lastPath = parts[parts.length - 1] ?? "";
  return lastPath.endsWith(".sql");
});

if (blocked.length > 0) {
  console.error("db:history guard failed. Historical migration SQL files cannot be modified/deleted in PRs:");
  for (const line of blocked) {
    console.error(` - ${line}`);
  }
  process.exit(1);
}

console.log("db:history guard passed");

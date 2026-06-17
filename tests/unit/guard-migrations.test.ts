import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

describe("guard-migrations", () => {
  it("passes on the bootstrap migration", () => {
    const result = spawnSync("node", ["scripts/db/guard-migrations.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("db:guard passed");
  });
});

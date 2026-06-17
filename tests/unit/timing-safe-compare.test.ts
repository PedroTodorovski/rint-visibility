import { describe, expect, it } from "vitest";

import { timingSafeCompare } from "../../src/lib/timing-safe-compare.js";

describe("timingSafeCompare", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeCompare("secret-key", "secret-key")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(timingSafeCompare("secret-key", "wrong-key!")).toBe(false);
  });

  it("returns false when lengths differ", () => {
    expect(timingSafeCompare("short", "much-longer-value")).toBe(false);
  });
});

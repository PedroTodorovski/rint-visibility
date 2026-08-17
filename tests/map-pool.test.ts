import { describe, expect, it } from "vitest";

import { mapPool } from "../src/lib/map-pool.js";

describe("mapPool", () => {
  it("preserves order under bounded concurrency", async () => {
    const started: number[] = [];
    const results = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      started.push(n);
      await new Promise((resolve) => setTimeout(resolve, 15 - n));
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(started[0]).toBe(1);
    expect(started[1]).toBe(2);
  });

  it("runs an empty list", async () => {
    expect(await mapPool([], 3, async (n) => n)).toEqual([]);
  });
});

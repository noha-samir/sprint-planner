import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./mapWithConcurrency";

describe("mapWithConcurrency", () => {
  it("never runs more than the limit at once and keeps result order", async () => {
    let running = 0;
    let maxRunning = 0;
    const results = await mapWithConcurrency([30, 5, 20, 1, 10], 3, async (delayMs) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      running -= 1;
      return delayMs * 2;
    });

    expect(maxRunning).toBe(3);
    expect(results).toEqual([60, 10, 40, 2, 20]);
  });

  it("returns an empty list for no items", async () => {
    await expect(mapWithConcurrency([], 3, async (item: number) => item)).resolves.toEqual([]);
  });
});

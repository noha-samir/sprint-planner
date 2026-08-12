import { describe, expect, it } from "vitest";
import { defaultPlannerMeta, mergePlannerMetaPatch } from "./plannerMeta";

describe("mergePlannerMetaPatch", () => {
  it("returns defaults when input is missing", () => {
    expect(mergePlannerMetaPatch(undefined)).toEqual(defaultPlannerMeta());
    expect(mergePlannerMetaPatch(null)).toEqual(defaultPlannerMeta());
  });

  it("keeps known fields and drops legacy snapshot2-style keys from the typed result", () => {
    const raw = {
      snapshot1TakenAt: "2026-01-01T00:00:00.000Z",
      snapshot1ReleaseByTaskId: { t1: "2026-01-02T00:00:00.000Z" },
      estimatedBaselineCapturedAt: "2026-01-01T00:00:00.000Z",
      uatTrackingEnabled: true,
      rulesVersion: 1,
      snapshot2TakenAt: "legacy",
      lastRefreshedAt: "legacy",
    };
    const merged = mergePlannerMetaPatch(raw as never);
    expect(merged.snapshot1TakenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(merged.snapshot1ReleaseByTaskId).toEqual({ t1: "2026-01-02T00:00:00.000Z" });
    expect(merged.estimatedBaselineCapturedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(merged.uatTrackingEnabled).toBe(true);
    expect(merged.rulesVersion).toBe(1);
    expect("snapshot2TakenAt" in merged).toBe(false);
  });
});

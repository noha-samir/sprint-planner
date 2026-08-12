import { describe, expect, it } from "vitest";
import { matchFeBeSubtasksFromSummaries, mergeDiscoveredIntoJiraMeta, reconcileFeBeSubtaskKeys } from "./discoverSubtasks";

describe("matchFeBeSubtasksFromSummaries", () => {
  it("matches FE, BE, Android, and IOS subtasks by summary prefix and story title", () => {
    const result = matchFeBeSubtasksFromSummaries(
      [
        { key: "BR-1", summary: "[FE] Pricing Engine" },
        { key: "BR-2", summary: "[BE] Pricing Engine" },
        { key: "BR-3", summary: "[Android] Pricing Engine" },
        { key: "BR-4", summary: "[IOS] Pricing Engine" },
        { key: "BR-5", summary: "[FE] Other Story" },
      ],
      "Pricing Engine",
    );
    expect(result).toEqual({
      feKey: "BR-1",
      beKey: "BR-2",
      androidKey: "BR-3",
      iosKey: "BR-4",
    });
  });

  it("maps legacy [MO] summaries to Android", () => {
    const result = matchFeBeSubtasksFromSummaries(
      [{ key: "BR-3", summary: "[MO] Pricing Engine" }],
      "Pricing Engine",
    );
    expect(result).toEqual({ androidKey: "BR-3" });
  });

  it("returns empty when story title does not match", () => {
    const result = matchFeBeSubtasksFromSummaries(
      [{ key: "BR-1", summary: "[FE] Other Story" }],
      "Pricing Engine",
    );
    expect(result).toEqual({});
  });
});

describe("mergeDiscoveredIntoJiraMeta", () => {
  it("merges discovered keys into planner metadata", () => {
    const meta = mergeDiscoveredIntoJiraMeta(
      "BR-100",
      {
        storyName: "Pricing Engine",
        feDevs: ["Karim"],
        beDevs: ["Abbas"],
        androidDevs: ["Nour"],
        iosDevs: ["Mina"],
        needsIos: true,
        feHours: 6,
        beHours: 8,
        androidHours: 5,
        iosHours: 4,
      },
      undefined,
      { feKey: "BR-201", beKey: "BR-202", androidKey: "BR-203", iosKey: "BR-204" },
    );
    expect(meta.subtasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "fe", key: "BR-201" }),
        expect.objectContaining({ role: "be", key: "BR-202" }),
        expect.objectContaining({ role: "android", key: "BR-203" }),
        expect.objectContaining({ role: "ios", key: "BR-204" }),
      ]),
    );
  });
});

describe("reconcileFeBeSubtaskKeys", () => {
  it("prefers metadata keys that still exist under the parent", () => {
    expect(
      reconcileFeBeSubtaskKeys(
        { feKey: "BR-1", beKey: "BR-2", androidKey: "BR-3", iosKey: "BR-4" },
        { feKey: "BR-9", beKey: "BR-8", androidKey: "BR-7", iosKey: "BR-6" },
        new Set(["BR-1", "BR-8", "BR-3", "BR-6"]),
      ),
    ).toEqual({ feKey: "BR-1", beKey: "BR-8", androidKey: "BR-3", iosKey: "BR-6" });
  });
});

import { describe, expect, it } from "vitest";
import {
  matchAllRoleSubtasksFromSummaries,
  matchFeBeSubtasksFromSummaries,
  mergeDiscoveredIntoJiraMeta,
  reconcileFeBeSubtaskKeys,
} from "./discoverSubtasks";

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

  it("falls back to role prefix when the story title is not in the summary", () => {
    const result = matchFeBeSubtasksFromSummaries(
      [{ key: "BR-1", summary: "[FE] Other Story" }],
      "Pricing Engine",
    );
    expect(result).toEqual({ feKey: "BR-1" });
  });
});

describe("matchAllRoleSubtasksFromSummaries", () => {
  it("keeps every role-prefixed subtask including multiple BEs", () => {
    expect(
      matchAllRoleSubtasksFromSummaries([
        { key: "BR-1", summary: "[FE] Pricing Engine" },
        { key: "BR-2", summary: "[BE] Pricing Engine — Abbas" },
        { key: "BR-3", summary: "[BE] Pricing Engine — kholaey" },
        { key: "BR-4", summary: "QC only" },
      ]),
    ).toEqual({
      fe: ["BR-1"],
      be: ["BR-2", "BR-3"],
      android: [],
      ios: [],
    });
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

  it("keeps multiple BE keys instead of overwriting the first", () => {
    const meta = mergeDiscoveredIntoJiraMeta(
      "BR-100",
      {
        storyName: "Pricing Engine",
        feDevs: [],
        beDevs: ["Abbas", "kholaey"],
        androidDevs: [],
        iosDevs: [],
        needsIos: false,
        feHours: 0,
        beHours: 10,
        androidHours: 0,
        iosHours: 0,
      },
      undefined,
      { fe: [], be: ["BR-11", "BR-13"], android: [], ios: [] },
    );
    expect(meta.subtasks.filter((item) => item.role === "be")).toEqual([
      expect.objectContaining({ key: "BR-11", assigneeName: "Abbas" }),
      expect.objectContaining({ key: "BR-13", assigneeName: "kholaey" }),
    ]);
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

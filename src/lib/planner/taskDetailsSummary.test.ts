import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import { buildTaskDetailsSummaryChips } from "./taskDetailsSummary";

const baseTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "t1",
    storyName: "Story",
    storyLink: "",
    status: "To Do",
    feHours: 0,
    beHours: 0,
    androidHours: 0,
    iosHours: 0,
    needsIos: false,
    integrationHours: 0,
    qcHours: 0,
    bufferHours: 0,
    feDevs: [],
    beDevs: [],
    androidDevs: [],
    iosDevs: [],
    qcs: [],
    productManagers: [],
    integrationFlags: {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    },
    ...overrides,
  }) as Task;

describe("buildTaskDetailsSummaryChips", () => {
  it("skips empty phases and formats hours", () => {
    expect(
      buildTaskDetailsSummaryChips(
        baseTask({
          beHours: 8,
          feHours: 4.5,
          androidHours: 12,
          integrationHours: 2,
          qcHours: 6,
          productManagers: ["Ali"],
          bufferHours: 1,
        }),
      ).map((chip) => chip.label),
    ).toEqual(["BE 8", "FE 4.5", "MO 12", "Int 2", "QC 6", "PM 1", "Buf 1"]);
  });

  it("returns empty list when nothing is set", () => {
    expect(buildTaskDetailsSummaryChips(baseTask())).toEqual([]);
  });
});

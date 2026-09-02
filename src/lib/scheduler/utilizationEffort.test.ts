import { describe, expect, it } from "vitest";
import { resolveUtilizationEffort } from "./utilizationEffort";
import type { Task } from "./types";

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  storyName: "Story",
  storyLink: "",
  poPriority: null,
  feDevs: ["FE-1"],
  feHours: 8,
  beDevs: ["BE-1"],
  beHours: 6,
  androidDevs: [],
  androidHours: 0,
  iosDevs: [],
  iosHours: 0,
  needsIos: false,
  integrationHours: 2,
  qcs: ["QC-1"],
  qcHours: 4,
  bufferHours: 1,
  status: "In Progress",
  ...overrides,
});

describe("resolveUtilizationEffort", () => {
  it("zeros UAT and Ready for Production statuses", () => {
    expect(resolveUtilizationEffort(baseTask({ status: "UAT", bufferHours: 3 }))).toEqual({
      feHours: 0,
      beHours: 0,
      androidHours: 0,
      iosHours: 0,
      integrationHours: 0,
      qcHours: 0,
      bufferHours: 0,
    });
    expect(resolveUtilizationEffort(baseTask({ status: "Ready for Production", bufferHours: 3 }))).toEqual({
      feHours: 0,
      beHours: 0,
      androidHours: 0,
      iosHours: 0,
      integrationHours: 0,
      qcHours: 0,
      bufferHours: 0,
    });
  });

  it("uses remaining hour overrides when set", () => {
    expect(
      resolveUtilizationEffort(
        baseTask({
          remainingBeHours: 2,
          remainingFeHours: 5,
        }),
      ),
    ).toMatchObject({
      beHours: 2,
      feHours: 5,
    });
  });

  it("caps overrides at estimate", () => {
    expect(
      resolveUtilizationEffort(
        baseTask({
          beHours: 6,
          remainingBeHours: 20,
        }),
      ).beHours,
    ).toBe(6);
  });
});

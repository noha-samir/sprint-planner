import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import {
  buildTaskDetailsSummaryChips,
  buildTaskDetailsSummaryRows,
} from "./taskDetailsSummary";

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

describe("buildTaskDetailsSummaryRows", () => {
  it("packs filled phases 2-per-row left to right", () => {
    const rows = buildTaskDetailsSummaryRows(
      baseTask({
        beHours: 10,
        feHours: 4,
        androidHours: 12,
        integrationHours: 2,
        qcHours: 6,
        productManagers: ["Ali"],
        bufferHours: 1,
      }),
    );
    expect(rows.map((row) => [row.left?.label ?? null, row.right?.label ?? null])).toEqual([
      ["BE 10", "FE 4"],
      ["Mob 12", "Int 2"],
      ["Buf 1", "QC 6"],
    ]);
  });

  it("fills the next cell instead of reserving fixed phase slots", () => {
    expect(
      buildTaskDetailsSummaryRows(baseTask({ beHours: 8, qcHours: 3 })).map((row) => [
        row.left?.label ?? null,
        row.right?.label ?? null,
      ]),
    ).toEqual([["BE 8", "QC 3"]]);
  });

  it("shows Mobile from iOS hours even when Needs iOS is off", () => {
    expect(
      buildTaskDetailsSummaryRows(
        baseTask({ iosHours: 6, needsIos: false }),
      ).map((row) => [row.left?.label ?? null, row.right?.label ?? null]),
    ).toEqual([["Mob 6", null]]);
  });

  it("shows Mobile from Star/Hubs app flag", () => {
    expect(
      buildTaskDetailsSummaryRows(baseTask({ mobileApp: "star" })).map((row) => [
        row.left?.label ?? null,
        row.right?.label ?? null,
      ]),
    ).toEqual([["Mob", null]]);
  });

  it("shows Integration from flags when hours are zero", () => {
    expect(
      buildTaskDetailsSummaryRows(
        baseTask({
          integrationFlags: {
            needsDevOps: true,
            needsCdc: true,
            needsDbSync: false,
            needsOtherSquad: false,
            needsThirdParty: false,
          },
        }),
      ).map((row) => [row.left?.label ?? null, row.right?.label ?? null]),
    ).toEqual([["Int 2", null]]);
  });
});

describe("buildTaskDetailsSummaryChips", () => {
  it("flattens packed rows", () => {
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
    ).toEqual(["BE 8", "FE 4.5", "Mob 12", "Int 2", "Buf 1", "QC 6"]);
  });

  it("returns empty list when nothing is set", () => {
    expect(buildTaskDetailsSummaryChips(baseTask())).toEqual([]);
  });
});

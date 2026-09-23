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
        beDevs: ["Abbas"],
        feHours: 4,
        feDevs: ["Karim"],
        androidHours: 12,
        androidDevs: ["Nour"],
        integrationHours: 2,
        integrationFlags: {
          needsDevOps: true,
          needsCdc: false,
          needsDbSync: false,
          needsOtherSquad: false,
          needsThirdParty: false,
        },
        qcHours: 6,
        qcs: ["Riley"],
        productManagers: ["Ali"],
        bufferHours: 1,
      }),
    );
    expect(rows.map((row) => [row.left?.label ?? null, row.right?.label ?? null])).toEqual([
      ["BE 10", "FE 4"],
      ["Mob 12", "Int 2"],
      ["Buf 1", "QC 6"],
    ]);
    expect(rows.flatMap((row) => [row.left, row.right]).every((chip) => !chip || !chip.incomplete)).toBe(
      true,
    );
  });

  it("marks hours without people as NA and dashed-incomplete", () => {
    const rows = buildTaskDetailsSummaryRows(baseTask({ beHours: 8, qcHours: 3 }));
    expect(rows.map((row) => [row.left?.label ?? null, row.right?.label ?? null])).toEqual([
      ["BE 8 · NA", "QC 3 · NA"],
    ]);
    expect(rows[0]?.left?.incomplete).toBe(true);
    expect(rows[0]?.right?.incomplete).toBe(true);
  });

  it("marks people without hours as Np incomplete", () => {
    const rows = buildTaskDetailsSummaryRows(baseTask({ feDevs: ["Karim"] }));
    expect(rows.map((row) => [row.left?.label ?? null, row.right?.label ?? null])).toEqual([
      ["Dev 1p", null],
    ]);
    expect(rows[0]?.left?.incomplete).toBe(true);
  });

  it("keeps FE label when BE is also present", () => {
    const rows = buildTaskDetailsSummaryRows(
      baseTask({ feDevs: ["Karim"], beDevs: ["Abbas"] }),
    );
    expect(rows.map((row) => [row.left?.label ?? null, row.right?.label ?? null])).toEqual([
      ["BE 1p", "FE 1p"],
    ]);
    expect(rows[0]?.left?.incomplete).toBe(true);
    expect(rows[0]?.right?.incomplete).toBe(true);
  });

  it("labels parent-style FE/QC as Dev/Testing", () => {
    expect(
      buildTaskDetailsSummaryRows(
        baseTask({
          issueType: "Technical Task",
          feHours: 8,
          qcHours: 3,
          qcs: ["Riley"],
        }),
      ).map((row) => [row.left?.label ?? null, row.right?.label ?? null]),
    ).toEqual([["Dev 8", "Testing 3"]]);

    expect(
      buildTaskDetailsSummaryRows(baseTask({ feHours: 5, qcHours: 2 })).map((row) => [
        row.left?.label ?? null,
        row.right?.label ?? null,
      ]),
    ).toEqual([["Dev 5 · NA", "Testing 2 · NA"]]);
  });

  it("shows Mobile from iOS hours even when Needs iOS is off", () => {
    expect(
      buildTaskDetailsSummaryRows(
        baseTask({ iosHours: 6, needsIos: false }),
      ).map((row) => [row.left?.label ?? null, row.right?.label ?? null]),
    ).toEqual([["Mob 6 · NA", null]]);
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
    const rows = buildTaskDetailsSummaryRows(
      baseTask({
        integrationFlags: {
          needsDevOps: true,
          needsCdc: true,
          needsDbSync: false,
          needsOtherSquad: false,
          needsThirdParty: false,
        },
      }),
    );
    expect(rows.map((row) => [row.left?.label ?? null, row.right?.label ?? null])).toEqual([
      ["Int 2", null],
    ]);
    expect(rows[0]?.left?.incomplete).toBe(true);
  });
});

describe("buildTaskDetailsSummaryChips", () => {
  it("flattens packed rows", () => {
    expect(
      buildTaskDetailsSummaryChips(
        baseTask({
          beHours: 8,
          beDevs: ["Abbas"],
          feHours: 4.5,
          feDevs: ["Karim"],
          androidHours: 12,
          androidDevs: ["Nour"],
          integrationHours: 2,
          integrationFlags: {
            needsDevOps: true,
            needsCdc: false,
            needsDbSync: false,
            needsOtherSquad: false,
            needsThirdParty: false,
          },
          qcHours: 6,
          qcs: ["Riley"],
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

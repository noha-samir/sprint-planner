import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import {
  buildDashboardTaskOrder,
  clusterTasksByReleaseGroup,
  floatNearReleaseStatusesToTop,
  sortTasksForDashboard,
} from "./dashboardTaskOrder";
import { buildReleaseGroupColorMap } from "./releaseGroupColors";

const task = (
  id: string,
  poPriority: number | null,
  releaseGroup: string | null = null,
  status: Task["status"] = "TODO",
): Task => ({
  id,
  storyName: id,
  storyLink: "",
  poPriority,
  feDevs: [],
  feHours: 0,
  beDevs: [],
  beHours: 0,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
  integrationHours: 0,
  qcs: [],
  productManagers: [],
  qcHours: 0,
  bufferHours: 0,
  status,
  releaseGroup,
});

describe("dashboardTaskOrder", () => {
  it("keeps the same release group adjacent after pin clustering", () => {
    const tasks = [task("a", 1, "Wave"), task("b", 2, null), task("c", 3, "Wave")];
    const pinned = ["a", "b", "c"];
    const releaseDates = new Map<string, Date>();

    const ordered = sortTasksForDashboard(tasks, releaseDates, pinned);
    expect(ordered.map((row) => row.id)).toEqual(["a", "c", "b"]);
  });

  it("groups release stories together by default, ordered by group priority", () => {
    const tasks = [
      task("a", 3, "Beta"),
      task("b", 1, "Alpha"),
      task("c", 2, "Beta"),
      task("d", 4, null),
    ];
    const order = buildDashboardTaskOrder(tasks, {
      sprintEndDate: new Date("2026-06-30T12:00:00.000Z"),
      tasks: tasks.map((row) => ({
        id: row.id,
        storyName: row.storyName,
        storyLink: "",
        poPriority: row.poPriority,
        status: "TODO",
        feBlocks: [],
        beBlocks: [],
          androidBlocks: [],
          iosBlocks: [],
          androidStart: null,
          androidEnd: null,
          iosStart: null,
          iosEnd: null,
        feStart: null,
        feEnd: null,
        beStart: null,
        beEnd: null,
        devEnd: null,
        integrationStart: null,
        integrationEnd: null,
        qcBlocks: [],
        qcStart: null,
        qcEnd: null,
        bufferStart: null,
        bufferEnd: null,
        uatReleaseDate: null,
        productionReleaseDate: null,
        releaseDate: new Date("2026-06-12T12:00:00.000Z"),
        isThursdayRelease: false,
        thursdayReleaseScope: "none",
        isOverflow: false,
        releaseGroup: row.releaseGroup ?? null,
      })),
    });
    expect(order).toEqual(["b", "c", "a", "d"]);
  });

  it("clusterTasksByReleaseGroup pulls matching names together", () => {
    const tasks = [task("a", 1, "X"), task("b", 2, "Y"), task("c", 3, "X")];
    expect(clusterTasksByReleaseGroup(tasks).map((row) => row.id)).toEqual(["a", "c", "b"]);
  });

  it("floats UAT then Ready for Production above other statuses", () => {
    const tasks = [
      task("todo", 1, null, "To Do"),
      task("rfp", 2, null, "Ready for Production"),
      task("progress", 3, null, "In Progress"),
      task("uat", 4, null, "UAT"),
    ];
    const ordered = sortTasksForDashboard(tasks, new Map(), null);
    expect(ordered.map((row) => row.id)).toEqual(["uat", "rfp", "todo", "progress"]);
  });

  it("keeps UAT / Ready for Production at the top after pinned clustering", () => {
    const tasks = [
      task("a", 1, "Wave", "To Do"),
      task("b", 2, null, "UAT"),
      task("c", 3, "Wave", "Ready for Production"),
    ];
    const ordered = sortTasksForDashboard(tasks, new Map(), ["a", "b", "c"]);
    expect(ordered.map((row) => row.id)).toEqual(["b", "c", "a"]);
  });

  it("does not pull lower-status release-group siblings into the UAT block", () => {
    const tasks = [
      task("uat", 5, "Wave", "UAT"),
      task("todo-same-group", 1, "Wave", "To Do"),
      task("rfp", 2, null, "Ready for Production"),
      task("other", 3, null, "In Progress"),
    ];
    const ordered = sortTasksForDashboard(tasks, new Map(), ["todo-same-group", "uat", "rfp", "other"]);
    expect(ordered.map((row) => row.id)).toEqual(["uat", "rfp", "todo-same-group", "other"]);
  });

  it("sorts by Order within the same status tier before release group", () => {
    const tasks = [
      task("uat-late", 4, "Zeta", "UAT"),
      task("uat-early", 1, "Alpha", "UAT"),
      task("todo-early", 1, null, "To Do"),
      task("todo-late", 9, null, "To Do"),
    ];
    const ordered = sortTasksForDashboard(tasks, new Map(), null);
    expect(ordered.map((row) => row.id)).toEqual(["uat-early", "uat-late", "todo-early", "todo-late"]);
  });

  it("floatNearReleaseStatusesToTop preserves relative order within tiers", () => {
    const tasks = [
      task("a", 1, null, "To Do"),
      task("b", 2, null, "UAT"),
      task("c", 3, null, "Ready for Production"),
      task("d", 4, null, "UAT"),
    ];
    expect(floatNearReleaseStatusesToTop(tasks).map((row) => row.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("releaseGroupColors", () => {
  it("assigns a unique nude color per release group", () => {
    const map = buildReleaseGroupColorMap(["Wave 1", "Wave 2", "Wave 1", null, ""]);
    expect(map.size).toBe(2);
    expect(map.get("Wave 1")).not.toEqual(map.get("Wave 2"));
    expect(map.get("Wave 1")?.backgroundColor).toMatch(/^#|hsl/);
  });
});

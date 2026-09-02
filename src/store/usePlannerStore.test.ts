import { describe, expect, it } from "vitest";
import type { Task } from "../lib/scheduler/types";
import {
  activeSprintTasks,
  buildCarryOverTasks,
  compactPrioritiesAfterRelease,
  enforceUniquePoPriorities,
} from "./taskRules";
import { mergeIncomingTasksWithCurrent, shouldSkipIncomingPlannerSnapshot } from "./replanMerge";

const makeTask = (id: string, poPriority: number | null, carryToNextSprint = false): Task => ({
  id,
  storyName: `Story ${id}`,
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
  integrationFlags: {
    needsDevOps: false,
    needsCdc: false,
    needsDbSync: false,
    needsOtherSquad: false,
    needsThirdParty: false,
  },
  qcs: [],
  productManagers: [],
  qcHours: 0,
  bufferHours: 0,
  carryToNextSprint,
  status: "TODO",
});

describe("store task helpers", () => {
  it("auto-shifts PO priorities to remain unique", () => {
    const tasks = [makeTask("a", 1), makeTask("b", 2), makeTask("c", 3), makeTask("d", null)];
    const updated = enforceUniquePoPriorities(tasks, "c", 2);
    expect(updated.find((item) => item.id === "a")?.poPriority).toBe(1);
    expect(updated.find((item) => item.id === "c")?.poPriority).toBe(2);
    expect(updated.find((item) => item.id === "b")?.poPriority).toBe(3);
    expect(updated.find((item) => item.id === "d")?.poPriority).toBeNull();
  });

  it("normalizes invalid priority values to minimum 1", () => {
    const tasks = [makeTask("a", 1), makeTask("b", 2)];
    const updated = enforceUniquePoPriorities(tasks, "b", 0);
    expect(updated.find((item) => item.id === "b")?.poPriority).toBe(1);
    expect(updated.find((item) => item.id === "a")?.poPriority).toBe(2);
  });

  it("keeps prioritized tasks contiguous after reordering", () => {
    const tasks = [makeTask("a", 1), makeTask("b", 2), makeTask("c", 3)];
    const moved = enforceUniquePoPriorities(tasks, "b", 3);
    expect(moved.find((item) => item.id === "a")?.poPriority).toBe(1);
    expect(moved.find((item) => item.id === "c")?.poPriority).toBe(2);
    expect(moved.find((item) => item.id === "b")?.poPriority).toBe(3);
  });

  it("compacts priorities when one task is cleared", () => {
    const tasks = [makeTask("a", 1), makeTask("b", 2), makeTask("c", 3)];
    const updated = enforceUniquePoPriorities(tasks, "b", null);
    expect(updated.find((item) => item.id === "a")?.poPriority).toBe(1);
    expect(updated.find((item) => item.id === "c")?.poPriority).toBe(2);
    expect(updated.find((item) => item.id === "b")?.poPriority).toBeNull();
  });

  it("returns only active sprint tasks", () => {
    const tasks = [makeTask("a", 1, false), makeTask("b", 2, true), makeTask("c", null, false)];
    const active = activeSprintTasks(tasks);
    expect(active.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("clears released story PO priority and compacts remaining priorities", () => {
    const tasks = [
      makeTask("a", 1),
      { ...makeTask("b", 2), status: "Released" as const },
      makeTask("c", 3),
    ];
    const updated = compactPrioritiesAfterRelease(tasks, "b");
    expect(updated.find((item) => item.id === "b")?.poPriority).toBeNull();
    expect(updated.find((item) => item.id === "a")?.poPriority).toBe(1);
    expect(updated.find((item) => item.id === "c")?.poPriority).toBe(2);
  });

  it("keeps the full board on Start New Sprint and only resets parked Next Sprint rows", () => {
    const tasks = [
      makeTask("a", 1, true),
      { ...makeTask("b", 2, true), status: "Testing" as const },
      { ...makeTask("c", 3, false), status: "In Progress" as const },
      { ...makeTask("done", 4, false), status: "Production" as const },
      { ...makeTask("closed", 5, false), status: "Closed" as const },
    ];
    const carry = buildCarryOverTasks(tasks);
    expect(carry.map((item) => item.id)).toEqual(["a", "b", "c", "done", "closed"]);
    expect(carry.find((item) => item.id === "a")?.status).toBe("To Do");
    expect(carry.find((item) => item.id === "b")?.status).toBe("To Do");
    expect(carry.find((item) => item.id === "c")?.status).toBe("In Progress");
    expect(carry.find((item) => item.id === "done")?.status).toBe("Production");
    expect(carry.every((item) => item.carryToNextSprint === false)).toBe(true);
    expect(carry.find((item) => item.id === "a")?.carriedFromPreviousSprint).toBe(false);
    expect(carry.find((item) => item.id === "c")?.carriedFromPreviousSprint).toBe(true);
    expect(carry.find((item) => item.id === "done")?.carriedFromPreviousSprint).toBe(true);
  });

  it("applies carry remaining overrides from the wizard", () => {
    const tasks = [{ ...makeTask("c", 1, false), status: "In Progress" as const, beHours: 10 }];
    const carry = buildCarryOverTasks(tasks, {
      c: { remainingBeHours: 3, remainingFeHours: null, remainingAndroidHours: null, remainingIosHours: null, remainingQcHours: null, remainingIntegrationHours: null, remainingBufferHours: null },
    });
    expect(carry[0].remainingBeHours).toBe(3);
    expect(carry[0].carriedFromPreviousSprint).toBe(true);
  });

  it("keeps local replanFromStep when server payload is null", () => {
    const incomingTasks: Task[] = [{ ...makeTask("a", 1), replanFromStep: null }];
    const currentTasks: Task[] = [{ ...makeTask("a", 1), replanFromStep: "QC" }];
    const merged = mergeIncomingTasksWithCurrent(incomingTasks, currentTasks);
    expect(merged[0].replanFromStep).toBe("QC");
  });

  it("keeps a newly added local task when hydrating an older server list", () => {
    const incomingTasks: Task[] = [makeTask("a", 1)];
    const currentTasks: Task[] = [makeTask("a", 1), makeTask("new-row", null)];
    const merged = mergeIncomingTasksWithCurrent(incomingTasks, currentTasks, { keepLocalOnly: true });
    expect(merged.map((task) => task.id)).toEqual(["a", "new-row"]);
  });

  it("does not keep local-only tasks after a clean server hydrate", () => {
    const incomingTasks: Task[] = [makeTask("a", 1)];
    const currentTasks: Task[] = [makeTask("a", 1), makeTask("gone", null)];
    const merged = mergeIncomingTasksWithCurrent(incomingTasks, currentTasks);
    expect(merged.map((task) => task.id)).toEqual(["a"]);
  });

  it("skips a stale GET that is older than a save already applied", () => {
    expect(
      shouldSkipIncomingPlannerSnapshot({
        incomingUpdatedAt: "2026-08-17T08:00:00.000Z",
        localMutationAt: null,
        knownServerUpdatedAt: "2026-08-17T08:00:05.000Z",
      }),
    ).toBe(true);
  });

  it("skips hydrate while unsynced local edits are newer than the snapshot", () => {
    expect(
      shouldSkipIncomingPlannerSnapshot({
        incomingUpdatedAt: "2026-08-17T08:00:00.000Z",
        localMutationAt: "2026-08-17T08:00:10.000Z",
        knownServerUpdatedAt: "2026-08-17T08:00:00.000Z",
      }),
    ).toBe(true);
  });
});

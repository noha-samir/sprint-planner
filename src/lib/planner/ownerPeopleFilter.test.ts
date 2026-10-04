import { describe, expect, it } from "vitest";
import {
  buildOwnerPeopleMatchSet,
  isOwnerPeopleMatch,
  listOwnerPeopleGroups,
  taskHasAssignedPerson,
} from "./ownerPeopleFilter";

const resources = [
  { name: "Sara Nabil", nickname: "Sara", type: "FE" as const },
  { name: "Omar Fathy", nickname: null, type: "BE" as const },
  { name: "Adam Lee", nickname: null, type: "BE" as const },
  { name: "Mona Adel", nickname: null, type: "QC" as const },
  { name: "Morgan Price", nickname: "Morgan", type: "PM" as const },
  { name: "Guest Dev", nickname: null, type: "OtherSquad" as const },
];

const emptyTask = { beDevs: [], feDevs: [], androidDevs: [], iosDevs: [], qcs: [], productManagers: [] };

describe("listOwnerPeopleGroups", () => {
  it("groups engineers and QC for Team in role order, sorted, skipping empty roles and other squads", () => {
    expect(listOwnerPeopleGroups("team", resources)).toEqual([
      { label: "BE", names: ["Adam Lee", "Omar Fathy"] },
      { label: "FE", names: ["Sara Nabil"] },
      { label: "QC", names: ["Mona Adel"] },
    ]);
  });

  it("lists only PMs for PM", () => {
    expect(listOwnerPeopleGroups("pm", resources)).toEqual([{ label: "PM", names: ["Morgan Price"] }]);
  });
});

describe("taskHasAssignedPerson", () => {
  const syncedFields = {
    storyName: "Story",
    status: "In Progress",
    feHours: 0,
    beHours: 0,
    androidHours: 0,
    iosHours: 0,
    qcHours: 0,
    feDevs: [],
    beDevs: [],
    androidDevs: [],
    iosDevs: [],
    qcEngineer: "",
    productManager: "",
  };
  const linked = (
    overrides: {
      subtasks?: Array<{ key: string; role: "fe" | "be" | "android" | "ios"; assigneeName: string; hours: number }>;
      qcEngineer?: string;
      productManager?: string;
    } = {},
  ) => ({
    parentIssueKey: "VEN-1",
    lastPushedAt: null,
    subtasks: overrides.subtasks ?? [],
    syncedFields: {
      ...syncedFields,
      qcEngineer: overrides.qcEngineer ?? "",
      productManager: overrides.productManager ?? "",
    },
  });

  it("matches the Jira issue's own assignee (Technical Task, Bug, or a Story assigned to them)", () => {
    const matchSet = buildOwnerPeopleMatchSet(["Omar Fathy"], resources);
    expect(taskHasAssignedPerson({ jiraAssigneeName: "omar fathy" }, matchSet)).toBe(true);
    expect(taskHasAssignedPerson({ jiraAssigneeName: "Guest Engineer" }, matchSet)).toBe(false);
    expect(taskHasAssignedPerson({ jiraAssigneeName: null }, matchSet)).toBe(false);
  });

  it("matches a Jira subtask assignee, by nickname too, and any of several picked people", () => {
    const task = {
      jiraAssigneeName: "Engineering Manager",
      jira: linked({ subtasks: [{ key: "VEN-2", role: "fe", assigneeName: "Sara", hours: 4 }] }),
    };
    expect(taskHasAssignedPerson(task, buildOwnerPeopleMatchSet(["Sara Nabil"], resources))).toBe(true);
    expect(taskHasAssignedPerson(task, buildOwnerPeopleMatchSet(["Omar Fathy", "Sara Nabil"], resources))).toBe(true);
    expect(taskHasAssignedPerson(task, buildOwnerPeopleMatchSet(["Omar Fathy"], resources))).toBe(false);
  });

  it("matches the QC Engineer and Product Manager fields Jira holds", () => {
    const task = { jira: linked({ qcEngineer: "Mona Adel", productManager: "Morgan Price" }) };
    expect(taskHasAssignedPerson(task, buildOwnerPeopleMatchSet(["Mona Adel"], resources))).toBe(true);
    expect(taskHasAssignedPerson(task, buildOwnerPeopleMatchSet(["Morgan Price"], resources))).toBe(true);
  });

  it("ignores planner-only assignments that Jira does not have", () => {
    const plannerOnly = {
      ...emptyTask,
      beDevs: ["Omar Fathy"],
      qcs: ["Mona Adel"],
      jira: linked(),
    };
    expect(taskHasAssignedPerson(plannerOnly, buildOwnerPeopleMatchSet(["Omar Fathy"], resources))).toBe(false);
    expect(taskHasAssignedPerson(plannerOnly, buildOwnerPeopleMatchSet(["Mona Adel"], resources))).toBe(false);
    const unlinked = { ...emptyTask, beDevs: ["Omar Fathy"], jiraAssigneeName: null };
    expect(taskHasAssignedPerson(unlinked, buildOwnerPeopleMatchSet(["Omar Fathy"], resources))).toBe(false);
  });
});

describe("isOwnerPeopleMatch", () => {
  it("is false for everyone when nobody is picked", () => {
    const matchSet = buildOwnerPeopleMatchSet([], resources);
    expect(matchSet.size).toBe(0);
    expect(isOwnerPeopleMatch("Sara Nabil", matchSet)).toBe(false);
  });
});

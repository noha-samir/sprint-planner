import { describe, expect, it } from "vitest";
import type { Resource, Task } from "@/lib/scheduler/types";
import { buildJiraSyncedFields, listJiraPendingChanges } from "@/lib/integrations/jira/syncedFields";
import { usePlannerStore } from "./usePlannerStore";

const makeTask = (id: string): Task => ({
  id,
  storyName: `Story ${id}`,
  storyLink: "",
  poPriority: null,
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
  carryToNextSprint: false,
  status: "To Do",
});

describe("applyTaskPatches", () => {
  it("applies every patch with a single store update", () => {
    usePlannerStore.setState({ tasks: [makeTask("a"), makeTask("b"), makeTask("c")] });
    let updates = 0;
    const unsubscribe = usePlannerStore.subscribe(() => {
      updates += 1;
    });

    usePlannerStore.getState().applyTaskPatches([
      { id: "a", patch: { status: "In Progress" } },
      { id: "b", patch: { feHours: 6 } },
      { id: "missing", patch: { status: "Testing" } },
    ]);
    unsubscribe();

    const byId = new Map(usePlannerStore.getState().tasks.map((task) => [task.id, task]));
    expect(updates).toBe(1);
    expect(byId.get("a")?.status).toBe("In Progress");
    expect(byId.get("b")?.feHours).toBe(6);
    expect(byId.get("c")?.status).toBe("To Do");
  });

  it("does nothing when no patch changes a task", () => {
    usePlannerStore.setState({ tasks: [makeTask("a")] });
    let updates = 0;
    const unsubscribe = usePlannerStore.subscribe(() => {
      updates += 1;
    });

    usePlannerStore.getState().applyTaskPatches([{ id: "a", patch: { status: "To Do" } }]);
    unsubscribe();

    expect(updates).toBe(0);
  });

  describe("Jira baseline follows the roster role rules", () => {
    const resources: Resource[] = [
      { name: "Mohamed Elkholaey", type: "BE" },
      { name: "Silvia Hassan", type: "OtherSquad" },
    ];
    const linkedTask = (): Task => {
      const task = { ...makeTask("a"), storyLink: "https://example.atlassian.net/browse/BR-1", beHours: 11 };
      task.beDevs = ["Mohamed Elkholaey"];
      return task;
    };
    const jiraWithOtherSquadDev = (task: Task): Task["jira"] => ({
      parentIssueKey: "BR-1",
      lastPushedAt: null,
      lastPulledAt: null,
      subtasks: [],
      syncedFields: {
        ...buildJiraSyncedFields(task),
        beDevs: ["Mohamed Elkholaey", "Silvia Hassan"],
      },
    });

    it("drops an Other squad dev from the baseline on a Jira-only patch, so nothing is pending", () => {
      const task = linkedTask();
      usePlannerStore.setState({ tasks: [task], resources });
      usePlannerStore.getState().applyTaskPatches([{ id: "a", patch: { jira: jiraWithOtherSquadDev(task) } }]);

      const saved = usePlannerStore.getState().tasks[0]!;
      expect(saved.jira?.syncedFields?.beDevs).toEqual(["Mohamed Elkholaey"]);
      expect(listJiraPendingChanges(saved)).toEqual([]);
    });

    it("clears the pending change when Revert puts the Jira names back", () => {
      const task = linkedTask();
      task.jira = jiraWithOtherSquadDev(task);
      usePlannerStore.setState({ tasks: [task], resources });
      usePlannerStore.getState().applyTaskPatches([
        { id: "a", patch: { beDevs: ["Mohamed Elkholaey", "Silvia Hassan"] } },
      ]);

      const saved = usePlannerStore.getState().tasks[0]!;
      expect(saved.beDevs).toEqual(["Mohamed Elkholaey"]);
      expect(listJiraPendingChanges(saved)).toEqual([]);
    });
  });
});

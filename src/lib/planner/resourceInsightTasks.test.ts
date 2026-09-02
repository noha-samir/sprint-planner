import { describe, expect, it } from "vitest";
import {
  buildResourceInsightTaskRows,
  hoursForResourceOnTask,
  isResourceAssignedOnTask,
  resourceInsightDedupeKey,
} from "./resourceInsightTasks";
import type { Resource, Task } from "@/lib/scheduler/types";

const beNoha: Resource = { name: "Noha Helmy", type: "BE" };

const baseTask = (overrides: Partial<Task>): Task => ({
  id: "t1",
  storyName: "Story",
  storyLink: "https://jira.example/browse/BR-1",
  poPriority: null,
  feDevs: [],
  feHours: 0,
  beDevs: ["Noha Helmy"],
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
  qcHours: 0,
  bufferHours: 0,
  status: "To Do",
  ...overrides,
});

describe("resourceInsightTasks", () => {
  it("counts zero-hour assignments", () => {
    const task = baseTask({ beHours: 0 });
    expect(isResourceAssignedOnTask(task, beNoha)).toBe(true);
    expect(hoursForResourceOnTask(task, beNoha)).toBe(0);
  });

  it("matches nickname aliases on assignee labels", () => {
    const resource: Resource = { name: "Noha Helmy", type: "BE", nickname: "Noha" };
    const task = baseTask({ beDevs: ["Noha"], beHours: 8 });
    expect(isResourceAssignedOnTask(task, resource)).toBe(true);
    expect(hoursForResourceOnTask(task, resource)).toBe(8);
  });

  it("dedupes the same Jira key and keeps the higher-hour row", () => {
    const rows = buildResourceInsightTaskRows(
      [
        baseTask({ id: "a", beHours: 0, storyName: "Zero" }),
        baseTask({
          id: "b",
          beHours: 6,
          storyName: "With hours",
          storyLink: "https://jira.example/browse/BR-1?focusedCommentId=1",
        }),
        baseTask({ id: "c", storyLink: "https://jira.example/browse/BR-2", beHours: 2 }),
      ],
      beNoha,
    );

    expect(rows).toHaveLength(2);
    const br1 = rows.find((row) => resourceInsightDedupeKey({ id: row.taskId, storyLink: row.storyLink }) === "jira:BR-1");
    expect(br1?.taskId).toBe("b");
    expect(br1?.totalHours).toBe(6);
    expect(br1?.storyLabel).toBe("With hours");
  });

  it("returns zero BE hours when story is in Testing", () => {
    const task = baseTask({ beHours: 12, status: "Testing", qcHours: 6, qcs: ["QC-1"] });
    expect(hoursForResourceOnTask(task, beNoha)).toBe(0);
  });

  it("skips next-sprint carry rows", () => {
    const rows = buildResourceInsightTaskRows(
      [baseTask({ carryToNextSprint: true, beHours: 4 })],
      beNoha,
    );
    expect(rows).toHaveLength(0);
  });

  it("hides Production and UAT from the people modal list", () => {
    const rows = buildResourceInsightTaskRows(
      [
        baseTask({ id: "prod", status: "Production", beHours: 8 }),
        baseTask({ id: "uat", status: "UAT", beHours: 8 }),
        baseTask({ id: "todo", status: "To Do", beHours: 5 }),
      ],
      beNoha,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].taskId).toBe("todo");
  });

  it("tags origin from carriedFromPreviousSprint", () => {
    const rows = buildResourceInsightTaskRows(
      [
        baseTask({ id: "new", storyLink: "https://jira.example/browse/BR-10", beHours: 4, carriedFromPreviousSprint: false }),
        baseTask({ id: "carry", storyLink: "https://jira.example/browse/BR-11", beHours: 3, carriedFromPreviousSprint: true }),
      ],
      beNoha,
    );
    expect(rows.find((row) => row.taskId === "new")?.origin).toBe("new");
    expect(rows.find((row) => row.taskId === "carry")?.origin).toBe("carry");
  });
});

import { describe, expect, it } from "vitest";
import {
  deriveParentStatusFromChildren,
  resolveParentStatusFromChildren,
  workflowStageForStatus,
} from "./parentStatusFromChildren";

describe("workflowStageForStatus", () => {
  it("puts review after In Progress and before Ready for Testing", () => {
    expect(workflowStageForStatus("To Do")).toBe(0);
    expect(workflowStageForStatus("In Progress")).toBe(1);
    expect(workflowStageForStatus("Blocked")).toBe(1);
    expect(workflowStageForStatus("Ready for Review")).toBe(2);
    expect(workflowStageForStatus("Initial Review")).toBe(2);
    expect(workflowStageForStatus("Final Review")).toBe(2);
    expect(workflowStageForStatus("Ready for Testing")).toBe(3);
    expect(workflowStageForStatus("UAT")).toBe(3);
    expect(workflowStageForStatus("Closed")).toBe(3);
  });
});

describe("deriveParentStatusFromChildren", () => {
  it("all To Do → To Do", () => {
    expect(deriveParentStatusFromChildren(["To Do", "To Do"])).toBe("To Do");
  });

  it("any started but not all ready → In Progress", () => {
    expect(deriveParentStatusFromChildren(["To Do", "In Progress"])).toBe("In Progress");
    expect(deriveParentStatusFromChildren(["Ready for Testing", "To Do"])).toBe("In Progress");
  });

  it("all Ready for Testing or later → Ready for Testing", () => {
    expect(deriveParentStatusFromChildren(["Ready for Testing", "Testing", "Closed"])).toBe("Ready for Testing");
  });

  it("follows the slowest subtask into Ready for Review", () => {
    expect(deriveParentStatusFromChildren(["Ready for Review", "Ready for Testing"])).toBe("Ready for Review");
    expect(deriveParentStatusFromChildren(["Ready for Review", "Initial Review"])).toBe("Ready for Review");
    expect(deriveParentStatusFromChildren(["Final Review", "Testing"])).toBe("Ready for Review");
    expect(deriveParentStatusFromChildren(["In Progress", "Ready for Testing"])).toBe("In Progress");
  });

  it("ignores Cancelled / Discoped subtasks", () => {
    expect(deriveParentStatusFromChildren(["Ready for Testing", "Cancelled"])).toBe("Ready for Testing");
    expect(deriveParentStatusFromChildren(["Cancelled", "Discoped"])).toBeNull();
  });

  it("returns null with no subtasks or a missing status", () => {
    expect(deriveParentStatusFromChildren([])).toBeNull();
    expect(deriveParentStatusFromChildren(["In Progress", undefined])).toBeNull();
  });
});

describe("resolveParentStatusFromChildren", () => {
  it("moves the parent forward", () => {
    expect(resolveParentStatusFromChildren("To Do", ["In Progress", "To Do"])).toEqual({ status: "In Progress" });
    expect(resolveParentStatusFromChildren("In Progress", ["Ready for Testing"])).toEqual({
      status: "Ready for Testing",
    });
    expect(resolveParentStatusFromChildren("In Progress", ["Ready for Review", "Ready for Testing"])).toEqual({
      status: "Ready for Review",
    });
    expect(resolveParentStatusFromChildren("Ready for Review", ["Ready for Testing", "Testing"])).toEqual({
      status: "Ready for Testing",
    });
  });

  it("never moves the parent back and warns instead", () => {
    const result = resolveParentStatusFromChildren("Testing", ["In Progress"]);
    expect(result.status).toBeUndefined();
    expect(result.warning).toContain('Subtasks point to "In Progress"');
  });

  it("does nothing when parent and subtasks are in the same stage", () => {
    expect(resolveParentStatusFromChildren("UAT", ["Ready for Testing"])).toEqual({});
    expect(resolveParentStatusFromChildren("To Do", ["To Do"])).toEqual({});
  });

  it("leaves Cancelled / Discoped parents alone", () => {
    expect(resolveParentStatusFromChildren("Cancelled", ["In Progress"])).toEqual({});
  });

  it("never moves or warns about a Blocked parent, whatever the subtasks say", () => {
    expect(resolveParentStatusFromChildren("Blocked", ["Ready for Testing", "Testing"])).toEqual({});
    expect(resolveParentStatusFromChildren(" blocked ", ["In Progress"])).toEqual({});
    expect(resolveParentStatusFromChildren("Blocked", ["To Do"])).toEqual({});
  });
});

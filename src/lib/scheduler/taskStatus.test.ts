import { describe, expect, it } from "vitest";
import {
  DEFAULT_JIRA_STORY_STATUSES,
  isExcludedFromSchedule,
  isHiddenByDefaultStatusFilter,
  isInactiveTaskStatus,
  isReleasedTaskStatus,
  isReleasePendingOnPmStatus,
  normalizeTaskStatus,
  resourceInsightStatusBucket,
  resourceInsightStatusRank,
  taskStatusColorKey,
} from "./taskStatus";

describe("taskStatus", () => {
  it("migrates legacy planner statuses to Jira names", () => {
    expect(normalizeTaskStatus("TODO")).toBe("To Do");
    expect(normalizeTaskStatus("InProgress")).toBe("In Progress");
    expect(normalizeTaskStatus("Released")).toBe("Production");
    expect(normalizeTaskStatus("Discoped")).toBe("Discoped");
  });

  it("keeps Jira status names as-is", () => {
    expect(normalizeTaskStatus("Testing")).toBe("Testing");
    expect(normalizeTaskStatus("To Do")).toBe("To Do");
  });

  it("treats discoped/cancelled/production as excluded from schedule", () => {
    expect(isInactiveTaskStatus("Discoped")).toBe(true);
    expect(isInactiveTaskStatus("Cancelled")).toBe(true);
    expect(isReleasedTaskStatus("Production")).toBe(true);
    expect(isReleasedTaskStatus("Ready for Production")).toBe(false);
    expect(isExcludedFromSchedule("Discoped")).toBe(true);
    expect(isExcludedFromSchedule("Cancelled")).toBe(true);
    expect(isExcludedFromSchedule("Production")).toBe(true);
    expect(isExcludedFromSchedule("Ready for Production")).toBe(false);
    expect(isExcludedFromSchedule("In Progress")).toBe(false);
  });

  it("marks UAT / STAGING / Ready for Production as release pending on PM", () => {
    expect(isReleasePendingOnPmStatus("UAT")).toBe(true);
    expect(isReleasePendingOnPmStatus("STAGING")).toBe(true);
    expect(isReleasePendingOnPmStatus("Ready for Production")).toBe(true);
    expect(isReleasePendingOnPmStatus("Testing")).toBe(false);
    expect(isReleasePendingOnPmStatus("Production")).toBe(false);
  });

  it("hides only discoped/cancelled/closed/production in the default status filter", () => {
    expect(isHiddenByDefaultStatusFilter("Discoped")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("Cancelled")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("Closed")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("Production")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("STAGING")).toBe(false);
    expect(isHiddenByDefaultStatusFilter("Ready for Production")).toBe(false);
    expect(isHiddenByDefaultStatusFilter("UAT")).toBe(false);
  });

  it("gives every default status a unique color key", () => {
    const keys = DEFAULT_JIRA_STORY_STATUSES.map((status) => taskStatusColorKey(status));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("default");
  });

  it("orders resource insight buckets To Do → In Progress → In Review → Done", () => {
    expect(resourceInsightStatusBucket("To Do")).toBe("todo");
    expect(resourceInsightStatusBucket("In Progress")).toBe("in-progress");
    expect(resourceInsightStatusBucket("Testing")).toBe("in-progress");
    expect(resourceInsightStatusBucket("Ready for Review")).toBe("in-review");
    expect(resourceInsightStatusBucket("Production")).toBe("done");
    expect(resourceInsightStatusRank("To Do")).toBeLessThan(resourceInsightStatusRank("In Progress"));
    expect(resourceInsightStatusRank("In Progress")).toBeLessThan(
      resourceInsightStatusRank("Ready for Review"),
    );
    expect(resourceInsightStatusRank("Ready for Review")).toBeLessThan(
      resourceInsightStatusRank("Production"),
    );
  });
});

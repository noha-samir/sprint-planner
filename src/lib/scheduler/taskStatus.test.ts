import { describe, expect, it } from "vitest";
import {
  DEFAULT_JIRA_STORY_STATUSES,
  isExcludedFromSchedule,
  isHiddenByDefaultStatusFilter,
  isInactiveTaskStatus,
  isReleasedTaskStatus,
  isReleaseDateHandoffStatus,
  isReleasePendingOnEmStatus,
  isReleasePendingOnPmStatus,
  isReleaseDateOnHoldStatus,
  hasNoComputedReleaseDates,
  noReleaseDateLabel,
  normalizeTaskStatus,
  buildStatusFilterOptions,
  defaultVisibleStatusFilter,
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

  it("marks UAT / STAGING as pending on PM and Ready for Production as pending on EM", () => {
    expect(isReleasePendingOnPmStatus("UAT")).toBe(true);
    expect(isReleasePendingOnPmStatus("STAGING")).toBe(true);
    expect(isReleasePendingOnPmStatus("Ready for Production")).toBe(false);
    expect(isReleasePendingOnEmStatus("Ready for Production")).toBe(true);
    expect(isReleasePendingOnEmStatus("UAT")).toBe(false);
    expect(isReleaseDateHandoffStatus("UAT")).toBe(true);
    expect(isReleaseDateHandoffStatus("Ready for Production")).toBe(true);
    expect(isReleaseDateHandoffStatus("Testing")).toBe(false);
    expect(noReleaseDateLabel("UAT")).toBe("Pending on PM");
    expect(noReleaseDateLabel("STAGING")).toBe("Pending on PM");
    expect(noReleaseDateLabel("Ready for Production")).toBe("Pending on EM");
    expect(noReleaseDateLabel("Testing")).toBeNull();
  });

  it("puts Blocked and Ready for Development on hold with no release dates", () => {
    expect(isReleaseDateOnHoldStatus("Blocked")).toBe(true);
    expect(isReleaseDateOnHoldStatus(" ready for development ")).toBe(true);
    expect(isReleaseDateOnHoldStatus("To Do")).toBe(false);
    expect(hasNoComputedReleaseDates("Blocked")).toBe(true);
    expect(hasNoComputedReleaseDates("Ready for Development")).toBe(true);
    expect(hasNoComputedReleaseDates("UAT")).toBe(true);
    expect(hasNoComputedReleaseDates("In Progress")).toBe(false);
    expect(noReleaseDateLabel("Blocked")).toBe("On hold");
    expect(noReleaseDateLabel("Ready for Development")).toBe("Awaiting dev");
  });

  it("hides inactive and released statuses in the default status filter", () => {
    expect(isHiddenByDefaultStatusFilter("Discoped")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("Cancelled")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("Closed")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("Production")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("Done")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("Released")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("Backlog")).toBe(true);
    expect(isHiddenByDefaultStatusFilter("STAGING")).toBe(false);
    expect(isHiddenByDefaultStatusFilter("Ready for Production")).toBe(false);
    expect(isHiddenByDefaultStatusFilter("UAT")).toBe(false);
    expect(isHiddenByDefaultStatusFilter("Open")).toBe(false);
  });

  it("builds status filter options from defaults plus extras on tasks", () => {
    expect(buildStatusFilterOptions(DEFAULT_JIRA_STORY_STATUSES, [])).toEqual([
      ...DEFAULT_JIRA_STORY_STATUSES,
    ]);
    expect(buildStatusFilterOptions(DEFAULT_JIRA_STORY_STATUSES, ["Open", "to do", "Done"])).toEqual([
      ...DEFAULT_JIRA_STORY_STATUSES,
      "Open",
      "Done",
    ]);
    expect(defaultVisibleStatusFilter(["To Do", "Open", "Done", "Production"])).toEqual([
      "To Do",
      "Open",
    ]);
  });

  it("gives every default status a unique color key", () => {
    const keys = DEFAULT_JIRA_STORY_STATUSES.map((status) => taskStatusColorKey(status));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("default");
  });

  it("colors Jira Done like Production instead of the neutral default", () => {
    expect(taskStatusColorKey("Done")).toBe("production");
    expect(taskStatusColorKey("done")).toBe("production");
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

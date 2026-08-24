import { describe, expect, it } from "vitest";
import {
  buildIssueTypeFilterOptions,
  effectiveIssueType,
  isParentlessPlannerTask,
  isStandaloneIssueType,
  taskMatchesIssueTypeFilter,
} from "./taskIssueFilters";

describe("taskIssueFilters", () => {
  it("treats bugs and tasks as standalone", () => {
    expect(isStandaloneIssueType("Bug")).toBe(true);
    expect(isStandaloneIssueType("Task")).toBe(true);
    expect(isStandaloneIssueType("Technical Task")).toBe(true);
    expect(isStandaloneIssueType("Story")).toBe(false);
    expect(isStandaloneIssueType("Epic")).toBe(false);
  });

  it("parentless filter matches standalone issues even with a Jira link", () => {
    expect(
      isParentlessPlannerTask({
        issueType: "Bug",
        storyLink: "https://bostateam.atlassian.net/browse/BR-73433",
      }),
    ).toBe(true);
    expect(
      isParentlessPlannerTask({
        issueType: "Story",
        storyLink: "https://bostateam.atlassian.net/browse/BR-100",
      }),
    ).toBe(false);
  });

  it("treats blank issue types as Story", () => {
    expect(effectiveIssueType(undefined)).toBe("Story");
    expect(effectiveIssueType(null)).toBe("Story");
    expect(effectiveIssueType("")).toBe("Story");
    expect(effectiveIssueType("  ")).toBe("Story");
    expect(effectiveIssueType("Bug")).toBe("Bug");
  });

  it("always includes the fixed Type list and appends extras from tasks", () => {
    expect(buildIssueTypeFilterOptions([])).toEqual(["Story", "Bug", "Task", "Technical Task"]);
    expect(buildIssueTypeFilterOptions(["Bug", "Spike", "story"])).toEqual([
      "Story",
      "Bug",
      "Task",
      "Technical Task",
      "Spike",
    ]);
  });

  it("matches Type filter using blank-as-Story", () => {
    expect(taskMatchesIssueTypeFilter({ issueType: undefined }, [])).toBe(true);
    expect(taskMatchesIssueTypeFilter({ issueType: undefined }, ["Story"])).toBe(true);
    expect(taskMatchesIssueTypeFilter({ issueType: "" }, ["Story"])).toBe(true);
    expect(taskMatchesIssueTypeFilter({ issueType: undefined }, ["Bug"])).toBe(false);
    expect(taskMatchesIssueTypeFilter({ issueType: "Bug" }, ["Bug"])).toBe(true);
    expect(taskMatchesIssueTypeFilter({ issueType: "bug" }, ["Bug"])).toBe(true);
  });
});

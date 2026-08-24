import { describe, expect, it } from "vitest";
import { isParentlessPlannerTask, isStandaloneIssueType } from "./taskIssueFilters";

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
});

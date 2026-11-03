import { describe, expect, it } from "vitest";
import {
  jiraSprintFromAgileIssue,
  listActiveJiraSprints,
  listBoardOpenSprints,
  partitionJiraSprintAdd,
  partitionJiraSprintClear,
  taskMatchesJiraSprintFilter,
} from "./jiraSprint";

describe("jiraSprintFromAgileIssue", () => {
  it("stores an active sprint ahead of closed ones", () => {
    expect(
      jiraSprintFromAgileIssue({
        fields: {
          sprint: { id: 9, name: "Sprint 42", state: "active" },
          closedSprints: [{ id: 3, name: "Sprint 41", state: "closed" }],
        },
      }),
    ).toEqual({ jiraSprintId: 9, jiraSprintName: "Sprint 42", jiraSprintState: "active" });
  });

  it("stores a future sprint", () => {
    expect(
      jiraSprintFromAgileIssue({
        fields: { sprint: { id: 10, name: "Sprint 43", state: "future" } },
      }).jiraSprintState,
    ).toBe("future");
  });

  it("stores the latest closed sprint when the issue is not in an open one", () => {
    expect(
      jiraSprintFromAgileIssue({
        fields: {
          sprint: null,
          closedSprints: [
            { id: 1, name: "Old", state: "closed" },
            { id: 2, name: "Newer", state: "closed" },
          ],
        },
      }),
    ).toEqual({ jiraSprintId: 2, jiraSprintName: "Newer", jiraSprintState: "closed" });
  });

  it("stores none when the issue has no sprint", () => {
    expect(jiraSprintFromAgileIssue({ fields: {} })).toEqual({
      jiraSprintId: null,
      jiraSprintName: null,
      jiraSprintState: "none",
    });
  });
});

describe("taskMatchesJiraSprintFilter", () => {
  const linked = (state: "active" | "future" | "closed" | "none" | null) => ({
    storyLink: "https://bosta.atlassian.net/browse/BR-1",
    jiraSprintState: state,
  });

  it("open matches only the active sprint", () => {
    expect(taskMatchesJiraSprintFilter(linked("active"), "open")).toBe(true);
    expect(taskMatchesJiraSprintFilter(linked("future"), "open")).toBe(false);
    expect(taskMatchesJiraSprintFilter(linked("none"), "open")).toBe(false);
    expect(taskMatchesJiraSprintFilter(linked(null), "open")).toBe(false);
  });

  it("none matches a missing link or a confirmed backlog issue", () => {
    expect(taskMatchesJiraSprintFilter({ storyLink: "", jiraSprintState: null }, "none")).toBe(true);
    expect(taskMatchesJiraSprintFilter(linked("none"), "none")).toBe(true);
    expect(taskMatchesJiraSprintFilter(linked("active"), "none")).toBe(false);
    expect(taskMatchesJiraSprintFilter(linked(null), "none")).toBe(false);
    expect(taskMatchesJiraSprintFilter(linked("closed"), "none")).toBe(false);
  });

  it("all matches every story", () => {
    expect(taskMatchesJiraSprintFilter(linked(null), "all")).toBe(true);
    expect(taskMatchesJiraSprintFilter(linked("closed"), "all")).toBe(true);
  });
});

describe("listActiveJiraSprints", () => {
  it("returns each active sprint once and drops closed ones", () => {
    expect(
      listActiveJiraSprints([
        { id: 4, name: "Sprint 42", state: "active" },
        { id: 4, name: "Sprint 42", state: "active" },
        { id: 3, name: "Old", state: "closed" },
        { id: 8, name: "26Q4S3", state: "active" },
      ]),
    ).toEqual([
      { jiraSprintId: 8, jiraSprintName: "26Q4S3" },
      { jiraSprintId: 4, jiraSprintName: "Sprint 42" },
    ]);
  });

  it("returns nothing when Jira has no open sprint", () => {
    expect(listActiveJiraSprints([])).toEqual([]);
  });
});

describe("listBoardOpenSprints", () => {
  it("returns active sprints, busiest first", () => {
    expect(
      listBoardOpenSprints([
        { jiraSprintId: 1, jiraSprintName: "DS-26Q4S1", jiraSprintState: "active" },
        { jiraSprintId: 2, jiraSprintName: "26Q4S4", jiraSprintState: "active" },
        { jiraSprintId: 2, jiraSprintName: "26Q4S4", jiraSprintState: "active" },
        { jiraSprintId: 3, jiraSprintName: "Old", jiraSprintState: "closed" },
        { jiraSprintId: null, jiraSprintName: null, jiraSprintState: "none" },
      ]),
    ).toEqual([
      { jiraSprintId: 2, jiraSprintName: "26Q4S4" },
      { jiraSprintId: 1, jiraSprintName: "DS-26Q4S1" },
    ]);
  });
});

describe("partitionJiraSprintAdd", () => {
  it("keeps stories that are not already in the open sprint", () => {
    const result = partitionJiraSprintAdd([
      { id: "a", storyName: "Open", storyLink: "BR-1", jiraSprintState: "active" },
      { id: "b", storyName: "Backlog", storyLink: "BR-2", jiraSprintState: "none" },
      { id: "c", storyName: "Unread", storyLink: "BR-3", jiraSprintState: null },
      { id: "d", storyName: "Later", storyLink: "BR-4", jiraSprintState: "future" },
      { id: "e", storyName: "Local", storyLink: "", jiraSprintState: null },
    ]);
    expect(result.eligible.map((row) => row.issueKey)).toEqual(["BR-2", "BR-3", "BR-4"]);
    expect(result.skipped.map((row) => row.reason)).toEqual([
      "Already in the open Jira sprint",
      "No Jira link",
    ]);
  });
});

describe("partitionJiraSprintClear", () => {
  it("keeps active and future issues and skips the rest", () => {
    const result = partitionJiraSprintClear([
      { id: "a", storyName: "Open", storyLink: "BR-1", jiraSprintState: "active" },
      { id: "b", storyName: "Later", storyLink: "BR-2", jiraSprintState: "future" },
      { id: "c", storyName: "Backlog", storyLink: "BR-3", jiraSprintState: "none" },
      { id: "d", storyName: "Old", storyLink: "BR-4", jiraSprintState: "closed" },
      { id: "e", storyName: "Unread", storyLink: "BR-5", jiraSprintState: null },
      { id: "f", storyName: "Local", storyLink: "", jiraSprintState: null },
    ]);
    expect(result.eligible.map((row) => row.issueKey)).toEqual(["BR-1", "BR-2"]);
    expect(result.skipped.map((row) => row.reason)).toEqual([
      "Already has no Jira sprint",
      "Only in a closed sprint",
      "Jira sprint has not been read yet — pull first",
      "No Jira link",
    ]);
  });
});

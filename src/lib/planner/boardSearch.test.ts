import { describe, expect, it } from "vitest";
import { taskMatchesBoardSearch } from "./boardSearch";

const story = (releaseGroup: string | null, storyLink: string, parentIssueKey?: string) => ({
  storyLink,
  releaseGroup,
  jira: parentIssueKey
    ? { parentIssueKey, lastPushedAt: null, subtasks: [] }
    : undefined,
});

describe("taskMatchesBoardSearch", () => {
  it("matches every story when the box is empty", () => {
    expect(taskMatchesBoardSearch(story("MMT2", "https://bostateam.atlassian.net/browse/BR-80878"), "  ")).toBe(true);
  });

  it("matches a release group by part of its name", () => {
    const task = story("MMT2", "https://bostateam.atlassian.net/browse/BR-80878");
    expect(taskMatchesBoardSearch(task, "mmt")).toBe(true);
    expect(taskMatchesBoardSearch(task, "other")).toBe(false);
  });

  it("matches a story number from the link or the Jira key", () => {
    expect(taskMatchesBoardSearch(story(null, "https://bostateam.atlassian.net/browse/BR-80878"), "80878")).toBe(true);
    expect(taskMatchesBoardSearch(story(null, "https://bostateam.atlassian.net/browse/BR-80878"), "br-80878")).toBe(true);
    expect(taskMatchesBoardSearch(story(null, "", "BR-76353"), "76353")).toBe(true);
    expect(taskMatchesBoardSearch(story("MMT2", "https://bostateam.atlassian.net/browse/BR-80878"), "76353")).toBe(false);
  });
});

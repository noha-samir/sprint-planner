import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import { isTaskEligibleForJiraPull, isTaskEligibleForJiraSync, resolveTaskForJiraSync, taskHasJiraSyncHours } from "./syncEligibility";

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  storyName: "Story",
  storyLink: "https://example.atlassian.net/browse/BR-1",
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
  qcs: [],
  productManagers: [],
  qcHours: 0,
  bufferHours: 0,
  status: "TODO",
  ...overrides,
});

describe("syncEligibility", () => {
  it("detects syncable hours or FE/BE/MO assignees", () => {
    expect(taskHasJiraSyncHours(task({ feHours: 2 }))).toBe(true);
    expect(taskHasJiraSyncHours(task({ feDevs: ["Karim"] }))).toBe(true);
    expect(taskHasJiraSyncHours(task({ androidHours: 3 }))).toBe(true);
    expect(taskHasJiraSyncHours(task({ androidDevs: ["Nour"] }))).toBe(true);
    expect(taskHasJiraSyncHours(task())).toBe(false);
  });

  it("requires jira link and syncable content for eligibility", () => {
    expect(isTaskEligibleForJiraSync(task({ feHours: 3 }))).toBe(true);
    expect(isTaskEligibleForJiraSync(task({ storyLink: "" }))).toBe(false);
    expect(isTaskEligibleForJiraSync(task())).toBe(false);
  });

  it("excludes Discoped stories from sync eligibility", () => {
    expect(isTaskEligibleForJiraSync(task({ feHours: 3, status: "Discoped" }))).toBe(false);
  });

  it("allows pull when a Jira link exists", () => {
    expect(isTaskEligibleForJiraPull(task({ feHours: 0 }))).toBe(true);
    expect(isTaskEligibleForJiraPull(task({ storyLink: "" }))).toBe(false);
    expect(isTaskEligibleForJiraPull(task({ status: "Discoped", feHours: 2 }))).toBe(false);
  });

  it("resolveTaskForJiraSync prefers link input draft", () => {
    const base = task({ storyLink: "" });
    const resolved = resolveTaskForJiraSync(base, "https://example.atlassian.net/browse/BR-99");
    expect(resolved.storyLink).toBe("https://example.atlassian.net/browse/BR-99");
    expect(isTaskEligibleForJiraSync(resolveTaskForJiraSync(task({ feHours: 2 }), "https://x/browse/BR-1"))).toBe(
      true,
    );
  });
});

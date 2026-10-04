import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import {
  isTaskEligibleForJiraPull,
  isTaskEligibleForJiraSync,
  listBulkSyncLeftOutStories,
  resolveTaskForJiraSync,
  taskHasJiraDevWork,
} from "./syncEligibility";

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
  it("detects dev work from FE/BE/Android/iOS hours or assignees", () => {
    expect(taskHasJiraDevWork(task({ feHours: 2 }))).toBe(true);
    expect(taskHasJiraDevWork(task({ feDevs: ["Karim"] }))).toBe(true);
    expect(taskHasJiraDevWork(task({ androidHours: 3 }))).toBe(true);
    expect(taskHasJiraDevWork(task({ androidDevs: ["Nour"] }))).toBe(true);
    expect(taskHasJiraDevWork(task({ iosDevs: ["Omar"], needsIos: true }))).toBe(true);
    expect(taskHasJiraDevWork(task({ iosDevs: ["Omar"] }))).toBe(false);
    expect(taskHasJiraDevWork(task({ qcHours: 2, qcs: ["Alice"], productManagers: ["Hala"] }))).toBe(false);
    expect(taskHasJiraDevWork(task())).toBe(false);
  });

  it("allows push for any linked story, including 0 hours and no people", () => {
    expect(isTaskEligibleForJiraSync(task({ feHours: 3 }))).toBe(true);
    expect(isTaskEligibleForJiraSync(task())).toBe(true);
    expect(isTaskEligibleForJiraSync(task({ storyLink: "" }))).toBe(false);
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

  it("lists soft left-out stories with reasons", () => {
    expect(
      listBulkSyncLeftOutStories([
        task({ id: "a", storyName: "Has hours", feHours: 2 }),
        task({ id: "b", storyName: "No link", storyLink: "", feHours: 2 }),
        task({ id: "c", storyName: "Empty hours" }),
        task({ id: "d", storyName: "Discoped", feHours: 2, status: "Discoped" }),
      ]),
    ).toEqual([
      { name: "No link", reason: "no_link" },
    ]);
  });
});

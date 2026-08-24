import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import {
  collapseTasksByStoryLink,
  filterDraftsSkippingExistingStoryLinks,
  storyLinkIdentityKey,
} from "./storyLinkIdentity";

const task = (overrides: Partial<Task>): Task => ({
  id: "t1",
  storyName: "Story",
  storyLink: "https://jira.example/browse/BR-1",
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

describe("storyLinkIdentity", () => {
  it("treats browse URLs with different query strings as the same Jira key", () => {
    expect(storyLinkIdentityKey("https://jira.example/browse/BR-1")).toBe("jira:BR-1");
    expect(storyLinkIdentityKey("https://jira.example/browse/BR-1?foo=1")).toBe("jira:BR-1");
    expect(storyLinkIdentityKey("BR-1")).toBe("jira:BR-1");
  });

  it("collapses duplicate links and keeps the higher-effort row", () => {
    const { tasks, removedIds } = collapseTasksByStoryLink([
      task({ id: "a", beHours: 0, storyName: "Empty" }),
      task({
        id: "b",
        beHours: 8,
        storyName: "Filled",
        storyLink: "https://jira.example/browse/BR-1?x=1",
      }),
      task({ id: "c", storyLink: "https://jira.example/browse/BR-2", beHours: 2 }),
      task({ id: "d", storyLink: "", storyName: "Manual" }),
    ]);

    expect(tasks.map((row) => row.id)).toEqual(["b", "c", "d"]);
    expect(removedIds).toEqual(["a"]);
    expect(tasks.find((row) => row.id === "b")?.storyName).toBe("Filled");
  });

  it("keeps Next-sprint carry when collapsing a higher-effort duplicate without the flag", () => {
    const { tasks } = collapseTasksByStoryLink([
      task({ id: "carry", beHours: 0, carryToNextSprint: true, storyName: "Carry" }),
      task({ id: "heavy", beHours: 10, carryToNextSprint: false, storyName: "Heavy" }),
    ]);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("heavy");
    expect(tasks[0].carryToNextSprint).toBe(true);
  });

  it("skips drafts that share a link with the board or earlier drafts", () => {
    const kept = filterDraftsSkippingExistingStoryLinks(
      [
        { storyLink: "https://jira.example/browse/BR-1", name: "dup" },
        { storyLink: "https://jira.example/browse/BR-3", name: "new" },
        { storyLink: "https://jira.example/browse/BR-3", name: "batch-dup" },
        { storyLink: "", name: "blank-a" },
        { storyLink: "", name: "blank-b" },
      ],
      [task({ storyLink: "https://jira.example/browse/BR-1" })],
    );

    expect(kept.map((row) => row.name)).toEqual(["new", "blank-a", "blank-b"]);
  });
});

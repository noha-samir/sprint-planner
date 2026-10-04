import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import {
  buildJiraSyncedFields,
  buildRevertToJiraPatch,
  formatJiraPendingChangesHint,
  listJiraPendingChanges,
  normalizeJiraSyncedFields,
} from "./syncedFields";

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  storyName: "Pricing Engine",
  storyLink: "https://example.atlassian.net/browse/BR-1",
  poPriority: null,
  feDevs: ["Karim"],
  feHours: 4,
  beDevs: ["Zeyad", "Abbas"],
  beHours: 6,
  androidDevs: [],
  androidHours: 0,
  iosDevs: ["Omar"],
  iosHours: 5,
  needsIos: false,
  integrationHours: 0,
  qcs: ["Hala"],
  productManagers: ["Nour"],
  qcHours: 3,
  bufferHours: 0,
  status: "In Progress",
  ...overrides,
});

/** Story baselined from its own current values (in sync with Jira). */
const syncedTask = (overrides: Partial<Task> = {}): Task => {
  const task = baseTask(overrides);
  return {
    ...task,
    jira: { parentIssueKey: "BR-1", lastPushedAt: null, subtasks: [], syncedFields: buildJiraSyncedFields(task) },
  };
};

describe("buildJiraSyncedFields", () => {
  it("sorts and dedupes names, rounds hours and ignores iOS when not needed", () => {
    const fields = buildJiraSyncedFields(
      baseTask({ beDevs: ["Zeyad", " Abbas ", "Zeyad"], feHours: 1.23456 }),
      "Ready for QC",
    );
    expect(fields.beDevs).toEqual(["Abbas", "Zeyad"]);
    expect(fields.feHours).toBe(1.23);
    expect(fields.iosHours).toBe(0);
    expect(fields.iosDevs).toEqual([]);
    expect(fields.status).toBe("Ready for QC");
    expect(fields.qcEngineer).toBe("Hala");
    expect(fields.productManager).toBe("Nour");
  });
});

describe("normalizeJiraSyncedFields", () => {
  it("returns undefined for non-objects", () => {
    expect(normalizeJiraSyncedFields(null)).toBeUndefined();
    expect(normalizeJiraSyncedFields("x")).toBeUndefined();
    expect(normalizeJiraSyncedFields([])).toBeUndefined();
  });

  it("fills missing fields with empty defaults", () => {
    expect(normalizeJiraSyncedFields({ storyName: " A ", feHours: "2", beDevs: ["b", "a"] })).toEqual({
      storyName: "A",
      status: "",
      feHours: 2,
      beHours: 0,
      androidHours: 0,
      iosHours: 0,
      qcHours: 0,
      feDevs: [],
      beDevs: ["a", "b"],
      androidDevs: [],
      iosDevs: [],
      qcEngineer: "",
      productManager: "",
    });
  });
});

describe("listJiraPendingChanges", () => {
  it("is empty when the story matches its baseline", () => {
    expect(listJiraPendingChanges(syncedTask())).toEqual([]);
  });

  it("is empty without a baseline, a Jira link, or when Discoped", () => {
    expect(listJiraPendingChanges(baseTask({ qcHours: 9 }))).toEqual([]);
    expect(listJiraPendingChanges({ ...syncedTask(), storyLink: "", qcHours: 9 })).toEqual([]);
    expect(listJiraPendingChanges({ ...syncedTask(), status: "Discoped", qcHours: 9 })).toEqual([]);
  });

  it("lists edited push fields in display order", () => {
    const task = { ...syncedTask(), qcHours: 0, beDevs: ["Abbas"], storyName: "Pricing v2", status: "in progress" };
    expect(listJiraPendingChanges(task)).toEqual([
      { field: "storyName", label: "Story name", from: "Pricing Engine", to: "Pricing v2" },
      { field: "beDevs", label: "BE developers", from: "Abbas, Zeyad", to: "Abbas" },
      { field: "qcHours", label: "Testing (QC) hours", from: "3h", to: "0h" },
    ]);
  });

  it("ignores edits Push does not send", () => {
    const task = { ...syncedTask(), bufferHours: 8, integrationHours: 4, poPriority: 1, iosHours: 20 };
    expect(listJiraPendingChanges(task)).toEqual([]);
  });

  it("labels FE hours as Dev hours for technical tasks", () => {
    const task = { ...syncedTask({ issueType: "Technical Task" }), feHours: 7 };
    expect(listJiraPendingChanges(task)[0]).toMatchObject({ field: "feHours", label: "Dev hours" });
  });
});

describe("buildRevertToJiraPatch", () => {
  it("returns no patch when the story is in sync", () => {
    expect(buildRevertToJiraPatch(syncedTask())).toEqual({});
  });

  it("puts every pending field back to the Jira values so Needs push clears", () => {
    const edited: Task = {
      ...syncedTask(),
      storyName: "Pricing v2",
      status: "Blocked",
      beDevs: ["Abbas"],
      beHours: 10,
      qcs: ["Mona", "Hala"],
      productManagers: [],
      bufferHours: 4,
    };

    const patch = buildRevertToJiraPatch(edited);

    expect(patch).toEqual({
      storyName: "Pricing Engine",
      status: "In Progress",
      beDevs: ["Abbas", "Zeyad"],
      beHours: 6,
      qcs: ["Hala", "Mona"],
      productManagers: ["Nour"],
    });
    expect(listJiraPendingChanges({ ...edited, ...patch })).toEqual([]);
  });

  it("turns Needs iOS back on when restoring iOS values Jira has", () => {
    const synced = syncedTask({ needsIos: true });
    const edited: Task = { ...synced, needsIos: false };

    const patch = buildRevertToJiraPatch(edited);

    expect(patch).toMatchObject({ iosHours: 5, iosDevs: ["Omar"], needsIos: true });
    expect(listJiraPendingChanges({ ...edited, ...patch })).toEqual([]);
  });
});

describe("formatJiraPendingChangesHint", () => {
  const changes = listJiraPendingChanges({ ...syncedTask(), qcHours: 0 });

  it("explains the change and how to fix it for editors", () => {
    const hint = formatJiraPendingChangesHint(changes, "01 Oct 13:20", true);
    expect(hint).toContain("last synced 01 Oct 13:20");
    expect(hint).toContain("• Testing (QC) hours: 3h → 0h");
    expect(hint).toContain("Click to push this story now");
  });

  it("tells viewers an editor must push and caps long lists", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ ...changes[0], label: `Field ${index}` }));
    const hint = formatJiraPendingChangesHint(many, null, false);
    expect(hint).not.toContain("last synced");
    expect(hint).toContain("…and 2 more");
    expect(hint).toContain("An editor needs to push this story");
  });
});

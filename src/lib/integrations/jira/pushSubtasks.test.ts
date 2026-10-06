import { describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import {
  bulkSyncTasksToJira,
  formatBulkSyncConfirmMessage,
  formatBulkSyncSummary,
  syncTaskToJira,
} from "./pushSubtasks";
import { buildJiraSyncedFields } from "./syncedFields";
import { defaultSquadJiraConfig } from "./types";

vi.mock("@/lib/authz/sessionJiraCredentials", () => ({
  requireJiraApiCredentials: async () => ({ siteUrl: "https://test.atlassian.net", email: "a@b.co", apiToken: "x" }),
}));

vi.mock("./client", () => ({
  createJiraSubtask: vi.fn(async () => "BR-NEW"),
  updateJiraSubtask: vi.fn(async () => undefined),
  updateJiraParentIssue: vi.fn(async () => undefined),
  JiraApiError: class JiraApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("./discoverSubtasks", () => ({
  listParentSubtasks: vi.fn(async () => []),
  listParentSubtasksFromIssue: vi.fn(async () => [
    { key: "BR-NEW", summary: "[FE] Pricing Engine", status: "Ready for Development" },
  ]),
  matchAllRoleSubtasksFromSummaries: vi.fn(() => ({ fe: [], be: [], android: [], ios: [] })),
  mergeDiscoveredIntoJiraMeta: vi.fn((_parent: string, _task: unknown, jiraMeta: unknown) => ({
    parentIssueKey: "BR-1",
    lastPushedAt: null,
    subtasks: (jiraMeta as { subtasks?: [] })?.subtasks ?? [],
  })),
}));

vi.mock("./userSearch", async () => {
  const actual = await vi.importActual<typeof import("./userSearch")>("./userSearch");
  return {
    ...actual,
    warningsForUnmappedPlannerNames: vi.fn(async (_credentials: unknown, names: string[]) =>
      names.map((name) => `No Jira account found for "${name}"`),
    ),
  };
});

vi.mock("./syncIssueStatus", () => ({
  pushPlannerStatusToJira: vi.fn(async () => ({
    changed: false,
    fromStatus: "To Do",
    toStatus: "To Do",
  })),
}));

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  storyName: "Pricing Engine",
  storyLink: "https://example.atlassian.net/browse/BR-1",
  poPriority: null,
  feDevs: ["Karim"],
  feHours: 4,
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
  status: "To Do",
  ...overrides,
});

describe("bulkSyncTasksToJira", () => {
  it("skips only tasks without a jira link; zero-hour stories still push", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "acc-1" };
    const result = await bulkSyncTasksToJira(
      [
        baseTask({ storyLink: "" }),
        baseTask({ id: "empty", feDevs: [], feHours: 0, beHours: 0, qcHours: 0 }),
        baseTask({ id: "task-2" }),
      ],
      config,
    );
    expect(result.skipped).toBe(1);
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("does not sync Discoped stories and reports them as errors", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "acc-1" };
    const { createJiraSubtask } = await import("./client");
    vi.mocked(createJiraSubtask).mockClear();
    const result = await bulkSyncTasksToJira(
      [
        baseTask({ id: "discoped", storyName: "Old Story", status: "Discoped" }),
        baseTask({ id: "task-2", storyName: "Active Story" }),
      ],
      config,
    );
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((row) => row.taskId === "discoped")).toMatchObject({
      ok: false,
      error: "Discoped stories are not synced to Jira",
    });
    expect(createJiraSubtask).toHaveBeenCalledTimes(1);
    const summary = formatBulkSyncSummary(result);
    expect(summary).toContain("Errors:");
    expect(summary).toContain("Discoped — not synced");
    expect(summary).toContain("— Old Story");
  });

  it("syncs zero-hour assignee and reports hours-without-assignee errors at the end", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "acc-1" };
    const { createJiraSubtask } = await import("./client");
    const result = await bulkSyncTasksToJira(
      [
        baseTask({
          id: "zero-fe",
          storyName: "Zero FE",
          feDevs: ["Karim"],
          feHours: 0,
          beDevs: [],
          beHours: 5,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
          qcHours: 0,
        }),
      ],
      config,
    );
    expect(result.synced).toBe(1);
    expect(result.results[0]?.warnings?.[0]).toContain("0 hours");
    expect(result.results[0]?.errors).toEqual(['BE has 5h on "Zero FE" but no assignee']);
    expect(createJiraSubtask).toHaveBeenCalled();
    const summary = formatBulkSyncSummary(result);
    expect(summary).toContain("Warnings:");
    expect(summary).toContain("Errors:");
    expect(summary).toContain('BE has 5h on "Zero FE" but no assignee');
    expect(summary.indexOf("Warnings:")).toBeGreaterThan(summary.indexOf("Errors:"));
  });

  it("pushes a Technical Task's Dev hours without missing-assignee errors", async () => {
    const config = defaultSquadJiraConfig();
    config.parentStoryFields.developmentEstimateHours = "customfield_dev";
    config.parentStoryFields.testingEstimateHours = "customfield_test";
    const { updateJiraParentIssue } = await import("./client");
    vi.mocked(updateJiraParentIssue).mockClear();
    const result = await bulkSyncTasksToJira(
      [
        baseTask({
          id: "tech",
          storyName: "Stop Redis errors",
          issueType: "Technical Task",
          feDevs: [],
          feHours: 6,
          qcHours: 0,
        }),
      ],
      config,
    );
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0]?.errors ?? []).toEqual([]);
    expect(vi.mocked(updateJiraParentIssue).mock.calls[0]?.[2]).toMatchObject({ customfield_dev: 6 });
  });

  it("reads the status of subtasks created in this push instead of leaving it unknown", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "acc-1" };
    const { listParentSubtasksFromIssue } = await import("./discoverSubtasks");
    vi.mocked(listParentSubtasksFromIssue).mockClear();
    const result = await syncTaskToJira(baseTask(), config);
    expect(listParentSubtasksFromIssue).toHaveBeenCalledTimes(1);
    expect(result.jira.subtasks).toEqual([
      expect.objectContaining({ key: "BR-NEW", role: "fe", status: "Ready for Development" }),
    ]);
  });

  it("does not re-read subtasks when nothing was created", async () => {
    const config = defaultSquadJiraConfig();
    const { listParentSubtasksFromIssue } = await import("./discoverSubtasks");
    vi.mocked(listParentSubtasksFromIssue).mockClear();
    await syncTaskToJira(baseTask({ feDevs: [], feHours: 0 }), config);
    expect(listParentSubtasksFromIssue).not.toHaveBeenCalled();
  });

  it("warns and keeps the status unknown when the new subtasks cannot be read", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "acc-1" };
    const { listParentSubtasksFromIssue } = await import("./discoverSubtasks");
    vi.mocked(listParentSubtasksFromIssue).mockRejectedValueOnce(new Error("boom"));
    const result = await syncTaskToJira(baseTask(), config);
    expect(result.jira.subtasks[0]?.status).toBeUndefined();
    expect(result.warnings).toContain("Could not read the status of new subtasks on BR-1 — pull from Jira to refresh.");
    expect(result.errors).toEqual([]);
  });

  it("pushes a status edited in the planner even when the subtasks are further along", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "acc-1" };
    const { listParentSubtasks } = await import("./discoverSubtasks");
    const { pushPlannerStatusToJira } = await import("./syncIssueStatus");
    vi.mocked(listParentSubtasks).mockResolvedValueOnce([
      { key: "BR-2", summary: "[BE] Pricing Engine", status: "In Progress" },
    ]);
    vi.mocked(pushPlannerStatusToJira).mockClear();
    const task = baseTask({ status: "Ready for Development" });
    task.jira = {
      parentIssueKey: "BR-1",
      lastPushedAt: null,
      subtasks: [],
      syncedFields: { ...buildJiraSyncedFields(task), status: "In Progress" },
    };
    const result = await syncTaskToJira(task, config);
    expect(result.statusFromChildren).toBeUndefined();
    expect(vi.mocked(pushPlannerStatusToJira).mock.calls[0]?.[2]).toBe("Ready for Development");
  });

  it("still moves an unedited status forward from the subtasks", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "acc-1" };
    const { listParentSubtasks } = await import("./discoverSubtasks");
    const { pushPlannerStatusToJira } = await import("./syncIssueStatus");
    vi.mocked(listParentSubtasks).mockResolvedValueOnce([
      { key: "BR-2", summary: "[BE] Pricing Engine", status: "In Progress" },
    ]);
    vi.mocked(pushPlannerStatusToJira).mockClear();
    const task = baseTask({ status: "To Do" });
    task.jira = { parentIssueKey: "BR-1", lastPushedAt: null, subtasks: [], syncedFields: buildJiraSyncedFields(task) };
    const result = await syncTaskToJira(task, config);
    expect(result.statusFromChildren).toEqual({ from: "To Do", to: "In Progress" });
    expect(vi.mocked(pushPlannerStatusToJira).mock.calls[0]?.[2]).toBe("In Progress");
  });

  it("formatBulkSyncSummary uses plain language for not synced vs failed", () => {
    const summary = formatBulkSyncSummary({
      synced: 14,
      failed: 0,
      skipped: 1,
      results: [
        {
          taskId: "t1",
          storyName: "Counter Hub – PUDO by Bosta",
          ok: false,
          skipped: true,
          skipReason: "No valid Jira story link",
        },
        { taskId: "t2", storyName: "Story C", ok: true },
      ],
    });
    expect(summary).toContain("14 stories synced to Jira.");
    expect(summary).not.toContain("skipped");
    expect(summary).not.toContain("0 failed");
    expect(summary).toContain("1 story not synced — add a Jira link");
    expect(summary).toContain("— Counter Hub – PUDO by Bosta");
  });

  it("formatBulkSyncSummary separates failed from not synced", () => {
    const summary = formatBulkSyncSummary({
      synced: 1,
      failed: 1,
      skipped: 1,
      results: [
        {
          taskId: "t1",
          storyName: "Story A",
          ok: false,
          skipped: true,
          skipReason: "No valid Jira story link",
        },
        {
          taskId: "t3",
          storyName: "Story C",
          ok: false,
          error: "Permission denied",
        },
        { taskId: "t4", storyName: "Story D", ok: true },
      ],
    });
    expect(summary).toContain("not synced — add a Jira link");
    expect(summary).toContain("Errors:");
    expect(summary).toContain("• Permission denied");
    expect(summary).toContain("— Story C");
  });

  it("formatBulkSyncConfirmMessage explains left-out stories", () => {
    expect(formatBulkSyncConfirmMessage(14, 15)).toContain("14 stories");
    expect(formatBulkSyncConfirmMessage(14, 15)).toContain("1 story skipped");
    expect(formatBulkSyncConfirmMessage(14, 15)).toContain("not an error");
  });

  it("formatBulkSyncConfirmMessage lists left-out story names", () => {
    const message = formatBulkSyncConfirmMessage(2, 4, 0, [
      { name: "Box Trips permissions", reason: "no_link" },
      { name: "Unlinked draft", reason: "no_link" },
    ]);
    expect(message).toContain("2 stories skipped");
    expect(message).toContain("• Box Trips permissions — no Jira link");
    expect(message).toContain("• Unlinked draft — no Jira link");
  });

  it("formatBulkSyncConfirmMessage calls out Discoped as errors", () => {
    const message = formatBulkSyncConfirmMessage(13, 15, 1);
    expect(message).toContain("13 stories");
    expect(message).toContain("1 story skipped");
    expect(message).toContain("1 story Discoped — not synced to Jira (reported as errors)");
  });
});
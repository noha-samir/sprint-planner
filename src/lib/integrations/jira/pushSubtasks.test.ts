import { describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import { bulkSyncTasksToJira, formatBulkSyncConfirmMessage, formatBulkSyncSummary } from "./pushSubtasks";
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
  discoverFeBeSubtasks: vi.fn(async () => ({})),
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
  it("skips tasks without jira link or syncable content", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "acc-1" };
    const result = await bulkSyncTasksToJira(
      [
        baseTask({ storyLink: "" }),
        baseTask({ feDevs: [], feHours: 0, beHours: 0, qcHours: 0 }),
        baseTask({ id: "task-2" }),
      ],
      config,
    );
    expect(result.skipped).toBe(2);
    expect(result.synced).toBe(1);
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
    expect(summary).toContain("Errors — Discoped stories are not synced to Jira");
    expect(summary).toContain("• Old Story");
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
    expect(summary.indexOf("Warnings — some subtasks were not created")).toBeGreaterThan(
      summary.indexOf("Warnings:"),
    );
    expect(summary).toContain('BE has 5h on "Zero FE" but no assignee');
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
    expect(summary).toContain("1 story not synced — add a Jira link:");
    expect(summary).toContain("• Counter Hub – PUDO by Bosta");
  });

  it("formatBulkSyncSummary separates failed from not synced", () => {
    const summary = formatBulkSyncSummary({
      synced: 1,
      failed: 1,
      skipped: 2,
      results: [
        {
          taskId: "t1",
          storyName: "Story A",
          ok: false,
          skipped: true,
          skipReason: "No valid Jira story link",
        },
        {
          taskId: "t2",
          storyName: "Story B",
          ok: false,
          skipped: true,
          skipReason: "No FE/BE assignees or FE/BE/QC hours to sync",
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
    expect(summary).toContain("not synced — add an FE/BE assignee or FE/BE/QC hours");
    expect(summary).toContain("failed — Jira returned an error");
    expect(summary).toContain("• Story C: Permission denied");
  });

  it("formatBulkSyncConfirmMessage explains left-out stories", () => {
    expect(formatBulkSyncConfirmMessage(14, 15)).toContain("14 stories");
    expect(formatBulkSyncConfirmMessage(14, 15)).toContain("1 story will be left out");
    expect(formatBulkSyncConfirmMessage(14, 15)).toContain("not a failure");
  });

  it("formatBulkSyncConfirmMessage calls out Discoped as errors", () => {
    const message = formatBulkSyncConfirmMessage(13, 15, 1);
    expect(message).toContain("13 stories");
    expect(message).toContain("1 story will be left out");
    expect(message).toContain("1 story Discoped — not synced to Jira (reported as errors)");
  });
});

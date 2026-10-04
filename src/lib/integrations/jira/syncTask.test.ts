import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import { syncTaskToJira } from "./pushSubtasks";
import { pushPlannerStatusToJira } from "./syncIssueStatus";
import { buildJiraSyncedFields, listJiraPendingChanges } from "./syncedFields";
import { defaultSquadJiraConfig } from "./types";
import * as client from "./client";
import * as discoverSubtasks from "./discoverSubtasks";

vi.mock("@/lib/authz/sessionJiraCredentials", () => ({
  requireJiraApiCredentials: vi.fn(async () => ({
    siteUrl: "https://test.atlassian.net",
    email: "a@b.co",
    apiToken: "x",
  })),
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
  listParentSubtasks: vi.fn(async () => [{ key: "BR-FE", summary: "[FE] Pricing Engine" }]),
  matchAllRoleSubtasksFromSummaries: vi.fn(() => ({ fe: ["BR-FE"], be: [], android: [], ios: [] })),
  mergeDiscoveredIntoJiraMeta: vi.fn(() => ({
    parentIssueKey: "BR-1",
    lastPushedAt: null,
    subtasks: [{ key: "BR-FE", role: "fe" as const, assigneeName: "Karim", hours: 4 }],
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

const task = (): Task => ({
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
  qcs: ["Alice"],
  qcHours: 2,
  bufferHours: 0,
  status: "To Do",
});

describe("syncTaskToJira", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates existing subtask assignee and hours", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };
    config.productManagerJiraAccountId = "pm-1";
    config.parentStoryFields = {
      developmentEstimateHours: "customfield_1",
      testingEstimateHours: "customfield_2",
      qcEngineer: "customfield_3",
      productManager: "customfield_4",
      branchName: "customfield_5",
    };

    await syncTaskToJira(task(), config);

    expect(client.updateJiraSubtask).toHaveBeenCalledWith(
      expect.anything(),
      "BR-FE",
      {
        summary: "[FE] Pricing Engine",
        jiraAccountId: "fe-1",
        hours: 4,
        developmentEstimateFieldId: "customfield_1",
      },
    );
    expect(client.createJiraSubtask).not.toHaveBeenCalled();
    expect(client.updateJiraParentIssue).toHaveBeenCalled();
    expect(pushPlannerStatusToJira).toHaveBeenCalledWith(
      expect.anything(),
      "BR-1",
      "To Do",
    );
  });

  it("sets parent development estimate to FE + BE + MO hours", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Nour: "mo-1", Alice: "qc-1" };
    config.productManagerJiraAccountId = "pm-1";
    config.parentStoryFields = {
      developmentEstimateHours: "customfield_1",
      testingEstimateHours: "customfield_2",
      qcEngineer: "customfield_3",
      productManager: "customfield_4",
      branchName: "customfield_5",
    };

    const withMobile = task();
    withMobile.beDevs = ["Karim"];
    withMobile.beHours = 3;
    withMobile.androidDevs = ["Nour"];
    withMobile.androidHours = 5;

    await syncTaskToJira(withMobile, config);

    expect(client.updateJiraParentIssue).toHaveBeenCalledWith(
      expect.anything(),
      "BR-1",
      expect.objectContaining({
        customfield_1: 12,
      }),
    );
  });

  it("updates assignee when developer changes on an existing subtask", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Razan: "fe-razan", Alice: "qc-1" };
    config.productManagerJiraAccountId = "pm-1";
    config.parentStoryFields = {
      developmentEstimateHours: "customfield_1",
      testingEstimateHours: "customfield_2",
      qcEngineer: "customfield_3",
      productManager: "customfield_4",
      branchName: "customfield_5",
    };

    const changedTask = task();
    changedTask.feDevs = ["Razan"];

    await syncTaskToJira(changedTask, config);

    expect(client.updateJiraSubtask).toHaveBeenCalledWith(
      expect.anything(),
      "BR-FE",
      expect.objectContaining({
        jiraAccountId: "fe-razan",
        hours: 4,
      }),
    );
  });

  it("creates a new subtask when updating hours fails for a missing issue", async () => {
    vi.mocked(client.updateJiraSubtask).mockRejectedValueOnce(
      new client.JiraApiError("Failed to update Jira subtask BR-STALE: not found", 404),
    );

    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };
    config.productManagerJiraAccountId = "pm-1";
    config.parentStoryFields = {
      developmentEstimateHours: "customfield_1",
      testingEstimateHours: "customfield_2",
      qcEngineer: "customfield_3",
      productManager: "customfield_4",
      branchName: "customfield_5",
    };

    const result = await syncTaskToJira(task(), config);

    expect(client.createJiraSubtask).toHaveBeenCalledTimes(1);
    expect(result.warnings.some((warning) => warning.includes("missing or inaccessible"))).toBe(true);
    expect(result.jira.subtasks[0]?.key).toBe("BR-NEW");
  });

  it("passes development estimate field when creating a subtask", async () => {
    vi.mocked(client.updateJiraSubtask).mockRejectedValueOnce(
      new client.JiraApiError("not found", 404),
    );

    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };
    config.productManagerJiraAccountId = "pm-1";
    config.parentStoryFields = {
      developmentEstimateHours: "customfield_10001",
      testingEstimateHours: "customfield_10002",
      qcEngineer: "customfield_10003",
      productManager: "customfield_10004",
      branchName: "customfield_10005",
    };

    await syncTaskToJira(task(), config);

    expect(client.createJiraSubtask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        hours: 4,
        developmentEstimateFieldId: "customfield_10001",
      }),
    );
  });

  it("keeps lastPulledAt and reports statusSynced when the status matches", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };
    const pulled = task();
    pulled.jira = { parentIssueKey: "BR-1", lastPushedAt: null, lastPulledAt: "2026-09-29T10:00:00.000Z", subtasks: [] };

    const result = await syncTaskToJira(pulled, config);

    expect(result.jira.lastPulledAt).toBe("2026-09-29T10:00:00.000Z");
    expect(result.statusSynced).toBe(true);
  });

  it("pushes the subtask status when the planner is behind (Ready for Testing + Done)", async () => {
    vi.mocked(discoverSubtasks.listParentSubtasks).mockResolvedValueOnce([
      { key: "BR-FE", summary: "[FE] Pricing Engine", status: "Ready for Testing" },
      { key: "BR-QA", summary: "QA checklist", status: "Done" },
    ]);
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };

    const result = await syncTaskToJira(task(), config);

    expect(pushPlannerStatusToJira).toHaveBeenCalledWith(expect.anything(), "BR-1", "Ready for Testing");
    expect(result.statusFromChildren).toEqual({ from: "To Do", to: "Ready for Testing" });
    expect(result.jira.subtasks.find((row) => row.key === "BR-FE")?.status).toBe("Ready for Testing");
  });

  it("keeps the planner status when it is ahead of the subtasks", async () => {
    vi.mocked(discoverSubtasks.listParentSubtasks).mockResolvedValueOnce([
      { key: "BR-FE", summary: "[FE] Pricing Engine", status: "In Progress" },
    ]);
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };

    const result = await syncTaskToJira({ ...task(), status: "Testing" }, config);

    expect(pushPlannerStatusToJira).toHaveBeenCalledWith(expect.anything(), "BR-1", "Testing");
    expect(result.statusFromChildren).toBeUndefined();
  });

  it("ignores the subtask rule when this push created a subtask (status unknown)", async () => {
    vi.mocked(discoverSubtasks.listParentSubtasks).mockResolvedValueOnce([
      { key: "BR-QA", summary: "QA checklist", status: "Done" },
    ]);
    vi.mocked(discoverSubtasks.mergeDiscoveredIntoJiraMeta).mockReturnValueOnce({
      parentIssueKey: "BR-1",
      lastPushedAt: null,
      subtasks: [],
    });
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };

    const result = await syncTaskToJira(task(), config);

    expect(client.createJiraSubtask).toHaveBeenCalled();
    expect(pushPlannerStatusToJira).toHaveBeenCalledWith(expect.anything(), "BR-1", "To Do");
    expect(result.statusFromChildren).toBeUndefined();
  });

  it("skips an existing subtask when summary, assignee and hours match the last sync", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };
    config.parentStoryFields = { ...config.parentStoryFields, testingEstimateHours: "customfield_2" };
    const synced = task();
    synced.qcHours = 5;
    synced.jira = {
      parentIssueKey: "BR-1",
      lastPushedAt: "2026-09-29T10:00:00.000Z",
      subtasks: [{ key: "BR-FE", role: "fe", assigneeName: "Karim", hours: 4, status: "In Progress" }],
    };
    vi.mocked(discoverSubtasks.listParentSubtasks).mockResolvedValueOnce([
      { key: "BR-FE", summary: "[FE] Pricing Engine", status: "In Progress" },
    ]);

    const result = await syncTaskToJira(synced, config);

    expect(client.updateJiraSubtask).not.toHaveBeenCalled();
    expect(client.createJiraSubtask).not.toHaveBeenCalled();
    expect(client.updateJiraParentIssue).toHaveBeenCalledWith(
      expect.anything(),
      "BR-1",
      expect.objectContaining({ customfield_2: 5 }),
    );
    expect(result.jira.subtasks).toEqual([
      { key: "BR-FE", role: "fe", assigneeName: "Karim", hours: 4, status: "In Progress" },
    ]);
  });

  it("still updates the subtask when hours changed since the last sync", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };
    const synced = task();
    synced.feHours = 6;
    synced.jira = {
      parentIssueKey: "BR-1",
      lastPushedAt: "2026-09-29T10:00:00.000Z",
      subtasks: [{ key: "BR-FE", role: "fe", assigneeName: "Karim", hours: 4 }],
    };

    await syncTaskToJira(synced, config);

    expect(client.updateJiraSubtask).toHaveBeenCalledWith(
      expect.anything(),
      "BR-FE",
      expect.objectContaining({ hours: 6 }),
    );
  });

  it("parent-only push (QC engineer + PM, no dev work) leaves subtasks and the 0 Dev estimate alone", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Alice: "qc-1", Hala: "pm-1" };
    config.productManagerFieldIsUser = true;
    config.qcEngineerFieldIsUser = true;
    config.parentStoryFields = {
      developmentEstimateHours: "customfield_dev",
      testingEstimateHours: "customfield_test",
      qcEngineer: "customfield_qc",
      productManager: "customfield_pm",
      branchName: "",
    };
    const parentOnly: Task = {
      ...task(),
      feDevs: [],
      feHours: 0,
      qcHours: 0,
      qcs: ["Alice"],
      productManagers: ["Hala"],
    };

    const result = await syncTaskToJira(parentOnly, config);

    expect(client.updateJiraSubtask).not.toHaveBeenCalled();
    expect(client.createJiraSubtask).not.toHaveBeenCalled();
    const fields = vi.mocked(client.updateJiraParentIssue).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(fields).toEqual({
      customfield_test: 0,
      customfield_qc: { accountId: "qc-1" },
      customfield_pm: { accountId: "pm-1" },
    });
    expect(result.jira.subtasks.map((row) => row.key)).toEqual(["BR-FE"]);
  });

  it("pushes 0 Testing hours and status for a story with no hours or people", async () => {
    const config = defaultSquadJiraConfig();
    config.parentStoryFields = {
      ...config.parentStoryFields,
      developmentEstimateHours: "customfield_dev",
      testingEstimateHours: "customfield_test",
    };
    const empty: Task = { ...task(), feDevs: [], feHours: 0, qcs: [], qcHours: 0 };

    await syncTaskToJira(empty, config);

    expect(client.updateJiraSubtask).not.toHaveBeenCalled();
    expect(client.createJiraSubtask).not.toHaveBeenCalled();
    const fields = vi.mocked(client.updateJiraParentIssue).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(fields.customfield_test).toBe(0);
    expect(fields).not.toHaveProperty("customfield_dev");
    expect(pushPlannerStatusToJira).toHaveBeenCalledWith(expect.anything(), "BR-1", "To Do");
  });

  it("reports statusSynced false when Jira cannot transition to the planner status", async () => {
    vi.mocked(pushPlannerStatusToJira).mockResolvedValueOnce({
      changed: false,
      fromStatus: "To Do",
      toStatus: null,
      warning: 'Could not move BR-1 from "To Do" to "Ready for Testing".',
    });
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };

    const result = await syncTaskToJira(task(), config);

    expect(result.statusSynced).toBe(false);
  });

  it("stores the pushed values as the new Needs push baseline", async () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };

    const result = await syncTaskToJira(task(), config);

    expect(result.jira.syncedFields).toEqual(buildJiraSyncedFields(task(), "To Do"));
    expect(listJiraPendingChanges({ ...task(), jira: result.jira })).toEqual([]);
  });

  it("keeps the previous baseline when a Jira call fails so the story still needs a push", async () => {
    vi.mocked(client.updateJiraParentIssue).mockRejectedValueOnce(new Error("Jira is down"));
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };
    config.parentStoryFields = { ...config.parentStoryFields, testingEstimateHours: "customfield_2" };
    const previous = buildJiraSyncedFields({ ...task(), qcHours: 8 });
    const edited: Task = {
      ...task(),
      jira: { parentIssueKey: "BR-1", lastPushedAt: null, subtasks: [], syncedFields: previous },
    };

    const result = await syncTaskToJira(edited, config);

    expect(result.errors.some((error) => error.includes("Jira is down"))).toBe(true);
    expect(result.jira.syncedFields).toEqual(previous);
  });

  it("records Jira's real status when the transition is refused", async () => {
    vi.mocked(pushPlannerStatusToJira).mockResolvedValueOnce({
      changed: false,
      fromStatus: "To Do",
      toStatus: null,
      warning: 'Could not move BR-1 from "To Do" to "Testing".',
    });
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1", Alice: "qc-1" };
    const testing: Task = { ...task(), status: "Testing" };

    const result = await syncTaskToJira(testing, config);

    expect(result.jira.syncedFields?.status).toBe("To Do");
    expect(listJiraPendingChanges({ ...testing, jira: result.jira })).toEqual([
      { field: "status", label: "Status", from: "To Do", to: "Testing" },
    ]);
  });
});

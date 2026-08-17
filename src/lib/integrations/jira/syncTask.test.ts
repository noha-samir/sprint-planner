import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import { syncTaskToJira } from "./pushSubtasks";
import { pushPlannerStatusToJira } from "./syncIssueStatus";
import { defaultSquadJiraConfig } from "./types";
import * as client from "./client";

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
});

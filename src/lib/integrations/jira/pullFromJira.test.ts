import { describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import {
  bulkPullTasksFromJira,
  extractJiraUserField,
  formatBulkPullConfirmMessage,
  formatBulkPullSummary,
  resolvePlannerNameFromJiraUser,
  syncTaskFromJira,
} from "./pullFromJira";
import { defaultSquadJiraConfig } from "./types";
import { discoverFeBeSubtasks, listParentSubtasks } from "./discoverSubtasks";

vi.mock("@/lib/authz/sessionJiraCredentials", () => ({
  requireJiraApiCredentials: async () => ({
    siteUrl: "https://test.atlassian.net",
    email: "a@b.co",
    apiToken: "x",
  }),
}));

vi.mock("./client", () => ({
  JiraApiError: class JiraApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("./discoverSubtasks", () => ({
  listParentSubtasks: vi.fn(async () => [
    { key: "BR-10", summary: "[FE] Pricing" },
    { key: "BR-11", summary: "[BE] Pricing" },
    { key: "BR-12", summary: "[MO] Pricing" },
  ]),
  discoverFeBeSubtasks: vi.fn(async () => ({
    feKey: "BR-10",
    beKey: "BR-11",
    androidKey: "BR-12",
  })),
}));

const mockedDiscoverFeBeSubtasks = vi.mocked(discoverFeBeSubtasks);
const mockedListParentSubtasks = vi.mocked(listParentSubtasks);
vi.mock("./credentials", async () => {
  const actual = await vi.importActual<typeof import("./credentials")>("./credentials");
  return {
    ...actual,
    jiraRestApiBase: () => "https://test.atlassian.net/rest/api/3",
    buildJiraBasicAuthHeader: () => "Basic xxx",
  };
});

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  storyName: "Pricing",
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
  status: "To Do",
  ...overrides,
});

describe("resolvePlannerNameFromJiraUser", () => {
  it("prefers assigneeMap then roster fuzzy match", () => {
    expect(
      resolvePlannerNameFromJiraUser(
        { accountId: "acc-1", displayName: "Casey Morgan" },
        { Casey: "acc-1" },
        [{ name: "Casey" }],
      ),
    ).toEqual({ name: "Casey" });

    expect(
      resolvePlannerNameFromJiraUser({ displayName: "Jordan Lee" }, {}, [
        { name: "Lee", nickname: "Jo" },
      ]),
    ).toEqual({ name: "Lee" });
  });

  it("returns null when unmapped so roster identity is preserved", () => {
    expect(resolvePlannerNameFromJiraUser({ displayName: "Someone" }, {}, [])).toBeNull();
  });
});

describe("extractJiraUserField", () => {
  it("reads user objects and plain strings", () => {
    expect(extractJiraUserField({ accountId: "a1", displayName: "Jamie" })).toEqual({
      accountId: "a1",
      displayName: "Jamie",
    });
    expect(extractJiraUserField("Riley")).toEqual({ displayName: "Riley" });
  });
});

describe("syncTaskFromJira", () => {
  it("maps parent status, QC, and FE/BE subtasks into a planner patch", async () => {
    const config = defaultSquadJiraConfig();
    config.parentStoryFields = {
      developmentEstimateHours: "customfield_10001",
      testingEstimateHours: "customfield_10002",
      qcEngineer: "customfield_10003",
      productManager: "customfield_10004",
      branchName: "customfield_10005",
    };
    config.assigneeMap = { Casey: "acc-fe", Morgan: "acc-be", Reese: "acc-mo", Riley: "acc-qc" };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/issue/BR-1?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              status: { name: "In Progress" },
              customfield_10002: 3,
              customfield_10003: { accountId: "acc-qc", displayName: "Riley Chen" },
            },
          }),
        };
      }
      if (url.includes("/issue/BR-10?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              assignee: { accountId: "acc-fe", displayName: "Casey" },
              timetracking: { originalEstimateSeconds: 14400 },
              customfield_10001: 4,
            },
          }),
        };
      }
      if (url.includes("/issue/BR-11?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              assignee: { accountId: "acc-be", displayName: "Morgan" },
              timetracking: { originalEstimateSeconds: 28800 },
              customfield_10001: 8,
            },
          }),
        };
      }
      if (url.includes("/issue/BR-12?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              assignee: { accountId: "acc-mo", displayName: "Reese" },
              timetracking: { originalEstimateSeconds: 18000 },
              customfield_10001: 5,
            },
          }),
        };
      }
      return { ok: false, text: async () => "missing" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskFromJira(baseTask(), config, [
      { name: "Casey" },
      { name: "Morgan" },
      { name: "Reese" },
      { name: "Riley" },
    ]);
    expect(result.patch.status).toBe("In Progress");
    expect(result.patch.qcHours).toBe(3);
    expect(result.patch.qcs).toEqual(["Riley"]);
    expect(result.patch.feHours).toBe(4);
    expect(result.patch.feDevs).toEqual(["Casey"]);
    expect(result.patch.beHours).toBe(8);
    expect(result.patch.beDevs).toEqual(["Morgan"]);
    expect(result.patch.androidHours).toBe(5);
    expect(result.patch.androidDevs).toEqual(["Reese"]);
    expect(result.jira.subtasks).toHaveLength(3);
    expect(result.jira.lastPulledAt).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("rejects Discoped stories", async () => {
    await expect(syncTaskFromJira(baseTask({ status: "Discoped" }), defaultSquadJiraConfig())).rejects.toThrow(
      /Discoped/,
    );
  });

  it("does not warn for missing Mobile when dashboard has no Android/IOS assignee", async () => {
    mockedDiscoverFeBeSubtasks.mockResolvedValueOnce({
      feKey: "BR-10",
      beKey: "BR-11",
    });
    mockedListParentSubtasks.mockResolvedValueOnce([
      { key: "BR-10", summary: "[FE] Pricing" },
      { key: "BR-11", summary: "[BE] Pricing" },
    ]);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/issue/BR-1?")) {
        return {
          ok: true,
          json: async () => ({ fields: { status: { name: "To Do" } } }),
        };
      }
      if (url.includes("/issue/BR-10?") || url.includes("/issue/BR-11?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              assignee: null,
              timetracking: { originalEstimateSeconds: 3600 },
            },
          }),
        };
      }
      return { ok: false, text: async () => "missing" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskFromJira(baseTask(), defaultSquadJiraConfig());
    expect(result.warnings.some((w) => /Android|IOS|MO/i.test(w))).toBe(false);
    expect(result.warnings).not.toContain("No [Android] (or legacy [MO]) subtask found under the Jira story");
    expect(result.warnings).not.toContain("No [IOS] subtask found under the Jira story");
    vi.unstubAllGlobals();
  });

  it("warns for missing Mobile when dashboard already has Android/IOS assignees", async () => {
    mockedDiscoverFeBeSubtasks.mockResolvedValueOnce({
      feKey: "BR-10",
      beKey: "BR-11",
    });
    mockedListParentSubtasks.mockResolvedValueOnce([
      { key: "BR-10", summary: "[FE] Pricing" },
      { key: "BR-11", summary: "[BE] Pricing" },
    ]);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/issue/BR-1?")) {
        return {
          ok: true,
          json: async () => ({ fields: { status: { name: "To Do" } } }),
        };
      }
      if (url.includes("/issue/BR-10?") || url.includes("/issue/BR-11?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              assignee: null,
              timetracking: { originalEstimateSeconds: 3600 },
            },
          }),
        };
      }
      return { ok: false, text: async () => "missing" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskFromJira(
      baseTask({ androidDevs: ["Hassan"], iosDevs: ["Mina"] }),
      defaultSquadJiraConfig(),
    );
    expect(result.warnings).toContain("No [Android] (or legacy [MO]) subtask found under the Jira story");
    expect(result.warnings).toContain("No [IOS] subtask found under the Jira story");
    vi.unstubAllGlobals();
  });

  it("still warns for missing FE/BE even with empty dashboard assignees", async () => {
    mockedDiscoverFeBeSubtasks.mockResolvedValueOnce({});
    mockedListParentSubtasks.mockResolvedValueOnce([]);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/issue/BR-1?")) {
        return {
          ok: true,
          json: async () => ({ fields: { status: { name: "To Do" } } }),
        };
      }
      return { ok: false, text: async () => "missing" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskFromJira(baseTask(), defaultSquadJiraConfig());
    expect(result.warnings).toContain("No [FE] subtask found under the Jira story");
    expect(result.warnings).toContain("No [BE] subtask found under the Jira story");
    expect(result.warnings).not.toContain("No [Android] (or legacy [MO]) subtask found under the Jira story");
    expect(result.warnings).not.toContain("No [IOS] subtask found under the Jira story");
    vi.unstubAllGlobals();
  });
});

describe("bulkPullTasksFromJira", () => {
  it("skips no-link and fails Discoped", async () => {
    const result = await bulkPullTasksFromJira(
      [
        baseTask({ id: "no-link", storyLink: "" }),
        baseTask({ id: "discoped", status: "Discoped" }),
      ],
      defaultSquadJiraConfig(),
    );
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
  });
});

describe("formatBulkPull messages", () => {
  it("explains left-out and Discoped", () => {
    expect(formatBulkPullConfirmMessage(2, 4, 1)).toContain("Pull 2 stories from Jira?");
    expect(formatBulkPullConfirmMessage(2, 4, 1)).toContain("Discoped");
  });

  it("summarizes pull results", () => {
    const summary = formatBulkPullSummary({
      synced: 1,
      failed: 1,
      skipped: 1,
      results: [
        { taskId: "a", storyName: "A", ok: true, warnings: ["No [FE] subtask found under the Jira story"] },
        {
          taskId: "b",
          storyName: "B",
          ok: false,
          skipped: true,
          skipReason: "No valid Jira story link",
        },
        {
          taskId: "c",
          storyName: "C",
          ok: false,
          error: "Discoped stories are not synced from Jira",
        },
      ],
    });
    expect(summary).toContain("1 story pulled from Jira");
    expect(summary).toContain("not pulled — add a Jira link");
    expect(summary).toContain("Discoped stories are not synced from Jira");
    expect(summary).toContain("Warnings:");
  });
});

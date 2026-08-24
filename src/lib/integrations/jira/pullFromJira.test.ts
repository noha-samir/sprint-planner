import { describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import {
  bulkPullTasksFromJira,
  extractJiraUserField,
  formatBulkPullConfirmMessage,
  formatBulkPullSummary,
  resolveHoursForDiscoveredTask,
  resolvePlannerNameFromJiraUser,
  syncTaskFromJira,
} from "./pullFromJira";
import { defaultSquadJiraConfig } from "./types";
import { listParentSubtasks } from "./discoverSubtasks";

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

vi.mock("./discoverSubtasks", async () => {
  const actual = await vi.importActual<typeof import("./discoverSubtasks")>("./discoverSubtasks");
  return {
    ...actual,
    listParentSubtasks: vi.fn(async () => [
      { key: "BR-10", summary: "[FE] Pricing" },
      { key: "BR-11", summary: "[BE] Pricing" },
      { key: "BR-12", summary: "[MO] Pricing" },
    ]),
  };
});

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

describe("resolveHoursForDiscoveredTask", () => {
  it("imports estimate hours without auto-assigning the Jira assignee to FE/BE/QC", () => {
    const result = resolveHoursForDiscoveredTask(
      "acc-be",
      7200,
      { Morgan: "acc-be" },
      [{ name: "Morgan", type: "BE" }],
    );
    expect(result.feHours).toBe(2);
    expect(result.beHours).toBe(0);
    expect(result.feDevs).toEqual([]);
    expect(result.beDevs).toEqual([]);
    expect(result.qcs).toEqual([]);
    expect(result.androidDevs).toEqual([]);
    expect(result.iosDevs).toEqual([]);
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

  it("pulls every [BE] subtask and sums hours across assignees", async () => {
    mockedListParentSubtasks.mockResolvedValueOnce([
      { key: "BR-10", summary: "[FE] Pricing" },
      { key: "BR-11", summary: "[BE] Pricing — Abbas" },
      { key: "BR-13", summary: "[BE] Pricing — kholaey" },
      { key: "BR-14", summary: "[BE] Pricing — extra" },
    ]);

    const config = defaultSquadJiraConfig();
    config.assigneeMap = {
      Casey: "acc-fe",
      Abbas: "acc-be-1",
      kholaey: "acc-be-2",
      Morgan: "acc-be-3",
    };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/issue/BR-1?")) {
        return {
          ok: true,
          json: async () => ({ fields: { status: { name: "In Progress" } } }),
        };
      }
      if (url.includes("/issue/BR-10?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              assignee: { accountId: "acc-fe", displayName: "Casey" },
              timetracking: { originalEstimateSeconds: 7200 },
            },
          }),
        };
      }
      if (url.includes("/issue/BR-11?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              assignee: { accountId: "acc-be-1", displayName: "Abbas" },
              timetracking: { originalEstimateSeconds: 14400 },
            },
          }),
        };
      }
      if (url.includes("/issue/BR-13?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              assignee: { accountId: "acc-be-2", displayName: "kholaey" },
              timetracking: { originalEstimateSeconds: 10800 },
            },
          }),
        };
      }
      if (url.includes("/issue/BR-14?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              assignee: { accountId: "acc-be-3", displayName: "Morgan" },
              timetracking: { originalEstimateSeconds: 3600 },
            },
          }),
        };
      }
      return { ok: false, text: async () => "missing" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskFromJira(baseTask(), config, [
      { name: "Casey" },
      { name: "Abbas" },
      { name: "kholaey" },
      { name: "Morgan" },
    ]);

    expect(result.patch.feHours).toBe(2);
    expect(result.patch.feDevs).toEqual(["Casey"]);
    expect(result.patch.beHours).toBe(8);
    expect(result.patch.beDevs).toEqual(["Abbas", "kholaey", "Morgan"]);
    expect(result.jira.subtasks.filter((row) => row.role === "be")).toHaveLength(3);
    expect(result.warnings.some((warning) => /keeps one|extra/i.test(warning))).toBe(false);
    vi.unstubAllGlobals();
  });

  it("keeps other subtasks when one BE child fetch fails", async () => {
    mockedListParentSubtasks.mockResolvedValueOnce([
      { key: "BR-11", summary: "[BE] Pricing — Abbas" },
      { key: "BR-13", summary: "[BE] Pricing — kholaey" },
    ]);

    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Abbas: "acc-be-1", kholaey: "acc-be-2" };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/issue/BR-1?")) {
        return {
          ok: true,
          json: async () => ({ fields: { status: { name: "To Do" } } }),
        };
      }
      if (url.includes("/issue/BR-11?")) {
        return {
          ok: true,
          json: async () => ({
            fields: {
              assignee: { accountId: "acc-be-1", displayName: "Abbas" },
              timetracking: { originalEstimateSeconds: 14400 },
            },
          }),
        };
      }
      return { ok: false, text: async () => "gone" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskFromJira(baseTask(), config, [{ name: "Abbas" }, { name: "kholaey" }]);
    expect(result.patch.beDevs).toEqual(["Abbas"]);
    expect(result.patch.beHours).toBe(4);
    expect(result.jira.subtasks).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes("BR-13"))).toBe(true);
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
    expect(formatBulkPullConfirmMessage(0, 0, 0, 3)).toContain("not on the dashboard");
  });

  it("mentions EM stories to add alongside a dashboard pull", () => {
    const message = formatBulkPullConfirmMessage(2, 2, 0, 3);
    expect(message).toContain("Pull 2 stories from Jira?");
    expect(message).toContain("Also add 3 stories under this EM");
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

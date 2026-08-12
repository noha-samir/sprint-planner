import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/scheduler/types";
import { buildBranchName, buildParentJiraFieldPayload } from "./parentFields";
import { buildParentIssuePlan, buildSubtaskPlan, subtaskPlanAssigneeErrors, subtaskPlanWarnings, unmappedAssigneeNamesForSync } from "./subtaskPlan";
import { defaultSquadJiraConfig } from "./types";

const baseTask = (): Task => ({
  id: "task-1",
  storyName: "Pricing Engine",
  storyLink: "https://example.atlassian.net/browse/VEN-1",
  poPriority: 3,
  feDevs: ["Karim"],
  feHours: 6,
  beDevs: ["Abbas", "kholaey"],
  beHours: 10,
  androidDevs: [],
  androidHours: 0,
  iosDevs: [],
  iosHours: 0,
  needsIos: false,
  integrationHours: 4,
  qcs: ["Hala"],
  qcHours: 3,
  productManagers: [],
  bufferHours: 2,
  status: "TODO",
});

describe("buildSubtaskPlan", () => {
  it("creates one FE and one BE subtask named after the main story", () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = {
      Karim: "fe-1",
      Abbas: "be-1",
      Hala: "qc-1",
    };

    const plan = buildSubtaskPlan(baseTask(), config);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      role: "fe",
      hours: 6,
      summary: "[FE] Pricing Engine",
    });
    expect(plan[1]).toMatchObject({
      role: "be",
      hours: 10,
      summary: "[BE] Pricing Engine",
    });
  });

  it("creates an Android subtask when android assignee is present", () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Nour: "mo-1" };
    const plan = buildSubtaskPlan(
      { ...baseTask(), feDevs: [], beDevs: [], androidDevs: ["Nour"], androidHours: 5 },
      config,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      role: "android",
      hours: 5,
      summary: "[Android] Pricing Engine",
    });
  });

  it("creates an IOS subtask when needsIos and ios assignee are present", () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Nour: "mo-1", Mina: "ios-1" };
    const plan = buildSubtaskPlan(
      {
        ...baseTask(),
        feDevs: [],
        beDevs: [],
        androidDevs: ["Nour"],
        androidHours: 5,
        needsIos: true,
        iosDevs: ["Mina"],
        iosHours: 4,
      },
      config,
    );
    expect(plan).toHaveLength(2);
    expect(plan.map((row) => row.summary)).toEqual([
      "[Android] Pricing Engine",
      "[IOS] Pricing Engine",
    ]);
  });

  it("appends Star/Hubs app marker after Android/IOS role in subtask summary", () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Nour: "mo-1", Mina: "ios-1" };
    const plan = buildSubtaskPlan(
      {
        ...baseTask(),
        feDevs: [],
        beDevs: [],
        androidDevs: ["Nour"],
        androidHours: 5,
        needsIos: true,
        iosDevs: ["Mina"],
        iosHours: 4,
        mobileApp: "star",
      },
      config,
    );
    expect(plan.map((row) => row.summary)).toEqual([
      "[Android] [Star app] Pricing Engine",
      "[IOS] [Star app] Pricing Engine",
    ]);
  });

  it("creates a 0h subtask when an assignee is present", () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1" };
    const plan = buildSubtaskPlan({ ...baseTask(), feHours: 0, beDevs: [], beHours: 0 }, config);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ role: "fe", assigneeName: "Karim", hours: 0 });
  });

  it("skips a role with hours but no assignee", () => {
    const config = defaultSquadJiraConfig();
    const plan = buildSubtaskPlan({ ...baseTask(), feDevs: [], beDevs: ["Abbas"] }, config);
    expect(plan).toHaveLength(1);
    expect(plan[0].role).toBe("be");
  });
});

describe("subtaskPlanWarnings and assignee errors", () => {
  it("warns for zero-hour assignees and errors for hours without a person", () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Karim: "fe-1" };
    const task = {
      ...baseTask(),
      feHours: 0,
      beDevs: [],
      beHours: 8,
      androidDevs: [],
      androidHours: 3,
      iosDevs: [],
      iosHours: 0,
      needsIos: false,
    };
    const plan = buildSubtaskPlan(task, config);
    expect(subtaskPlanWarnings(plan, task)[0]).toContain("0 hours");
    expect(subtaskPlanAssigneeErrors(task)).toEqual([
      'BE has 8h on "Pricing Engine" but no assignee',
      'Android has 3h on "Pricing Engine" but no assignee',
    ]);
  });
});

describe("buildBranchName", () => {
  it("uses story name and Jira issue number", () => {
    expect(buildBranchName(baseTask())).toBe("Pricing Engine - 1");
  });

  it("falls back to story name when there is no Jira link", () => {
    expect(buildBranchName({ ...baseTask(), storyLink: "" })).toBe("Pricing Engine");
  });
});

describe("buildParentIssuePlan", () => {
  it("maps parent custom field values from planner row", () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { Hala: "qc-1", "Alex Rivera": "pm-1" };

    const parent = buildParentIssuePlan(
      { ...baseTask(), productManagers: ["Alex Rivera"] },
      config,
      16,
    );
    expect(parent).toMatchObject({
      qcEngineerName: "Hala",
      qcJiraAccountId: "qc-1",
      developmentHours: 16,
      testingHours: 3,
      productManagerName: "Alex Rivera",
      productManagerJiraAccountId: "pm-1",
      branchName: "Pricing Engine - 1",
    });
  });

  it("resolves product manager account id from assignee map", () => {
    const config = defaultSquadJiraConfig();
    config.assigneeMap = { "Alex Rivera": "pm-from-map" };

    const parent = buildParentIssuePlan(
      { ...baseTask(), productManagers: ["Alex Rivera"] },
      config,
      10,
    );
    expect(parent.productManagerJiraAccountId).toBe("pm-from-map");
  });
});

describe("buildParentJiraFieldPayload", () => {
  it("maps values onto configured Jira custom field ids", () => {
    const config = defaultSquadJiraConfig();
    config.parentStoryFields = {
      developmentEstimateHours: "customfield_10001",
      testingEstimateHours: "customfield_10002",
      qcEngineer: "customfield_10003",
      productManager: "customfield_10004",
      branchName: "customfield_10005",
    };

    const fields = buildParentJiraFieldPayload(config, {
      qcEngineerName: "Hala",
      qcJiraAccountId: "qc-1",
      developmentHours: 16,
      testingHours: 3,
      productManagerName: "Alex Rivera",
      productManagerJiraAccountId: "pm-1",
      branchName: "Pricing Engine - 1",
    });

    expect(fields).toEqual({
      customfield_10001: 16,
      customfield_10002: 3,
      customfield_10003: { accountId: "qc-1" },
      customfield_10004: { accountId: "pm-1" },
      customfield_10005: "Pricing Engine - 1",
    });
  });
});

describe("unmappedAssigneeNamesForSync", () => {
  it("collects FE/BE/QC/PM names that lack a Jira account id", () => {
    const config = defaultSquadJiraConfig();
    config.qcEngineerFieldIsUser = true;
    config.productManagerFieldIsUser = true;
    const names = unmappedAssigneeNamesForSync(
      [
        {
          role: "fe",
          assigneeName: "Karim",
          jiraAccountId: null,
          hours: 4,
          summary: "[FE] Pricing Engine",
        },
      ],
      {
        qcEngineerName: "Hala",
        qcJiraAccountId: null,
        developmentHours: 10,
        testingHours: 3,
        productManagerName: "Alex Rivera",
        productManagerJiraAccountId: null,
        branchName: "Pricing Engine - 1",
      },
      config,
    );
    expect(names).toEqual(["Karim", "Hala", "Alex Rivera"]);
  });
});

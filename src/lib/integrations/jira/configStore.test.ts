import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    squadJiraConfig: {
      findUnique: vi.fn().mockResolvedValue({
        squadId: "ventures",
        siteUrl: "https://example.atlassian.net",
        projectKey: "DEMO",
        issueTypeSubTask: "Sub-task",
        productManagerName: "Alex Rivera",
        productManagerJiraAccountId: "acct-pm-1",
        developmentEstimateFieldId: "customfield_10001",
        testingEstimateFieldId: null,
        qcEngineerFieldId: null,
        productManagerFieldId: null,
        branchNameFieldId: null,
        qcEngineerFieldIsUser: true,
        productManagerFieldIsUser: true,
        subtaskSquadFieldId: null,
        subtaskSquadOptionId: "10001",
        assigneesSyncedAt: null,
        assignees: [
          { resourceName: "Morgan", jiraAccountId: "acct-dev-1" },
          { resourceName: "Casey", jiraAccountId: "acct-dev-2" },
        ],
      }),
      findFirst: vi.fn(),
    },
    squad: {
      findUnique: vi.fn().mockResolvedValue({ id: "ventures" }),
    },
  },
}));

import { readSquadJiraConfig, resolveJiraSiteUrl } from "./configStore";

describe("readSquadJiraConfig ventures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads product settings from DB only (no env merge)", async () => {
    const config = await readSquadJiraConfig("ventures");
    expect(config.siteUrl).toBe("https://example.atlassian.net");
    expect(config.subtaskSquadOptionId).toBe("10001");
    expect(config.projectKey).toBe("DEMO");
    expect(config.parentStoryFields.developmentEstimateHours).toBe("customfield_10001");
    expect(config.assigneeMap.Casey).toBe("acct-dev-2");
    expect(config.assigneeMap.Morgan).toBe("acct-dev-1");
    expect(config.productManagerName).toBe("Alex Rivera");
    expect(config.productManagerJiraAccountId).toBe("acct-pm-1");
  });
});

describe("resolveJiraSiteUrl", () => {
  it("returns the preferred squad site URL", async () => {
    const url = await resolveJiraSiteUrl("ventures");
    expect(url).toBe("https://example.atlassian.net");
  });
});

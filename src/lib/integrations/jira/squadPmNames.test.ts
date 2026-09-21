import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    squad: { findUnique: vi.fn() },
    resource: { findMany: vi.fn() },
  },
}));

vi.mock("./configStore", () => ({
  readSquadJiraConfig: vi.fn(),
}));

vi.mock("@/lib/authz/sessionJiraCredentials", () => ({
  requireJiraApiCredentials: vi.fn(),
}));

vi.mock("./discoverEmStories", () => ({
  resolveEmJiraAccountId: vi.fn(),
}));

vi.mock("./userSearch", () => ({
  searchJiraUsers: vi.fn(),
}));

vi.mock("./jiraSearch", () => ({
  quoteJql: (value: string) => `"${value}"`,
  searchJqlIssues: vi.fn(),
}));

import { prisma } from "@/lib/db/prisma";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { readSquadJiraConfig } from "./configStore";
import { resolveEmJiraAccountId } from "./discoverEmStories";
import { searchJiraUsers } from "./userSearch";
import { resolveSquadPmRosterNames } from "./squadPmNames";

describe("resolveSquadPmRosterNames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireJiraApiCredentials).mockRejectedValue(new Error("no jira"));
    vi.mocked(resolveEmJiraAccountId).mockResolvedValue(null);
    vi.mocked(searchJiraUsers).mockResolvedValue([]);
  });

  it("resolves PM names and account ids from roster + Jira config when pmEmails is empty", async () => {
    vi.mocked(prisma.squad.findUnique).mockResolvedValue({ pmEmails: [] } as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      { name: "Ali Rekaby", nickname: null, jiraMappings: [] },
      { name: "Ahmed Sharaf", nickname: null, jiraMappings: [] },
    ] as never);
    vi.mocked(readSquadJiraConfig).mockResolvedValue({
      assigneeMap: {
        "Ali Rekaby": "acct-ali",
        "Ahmed Sharaf": "acct-sharaf",
      },
      productManagerName: "Ali Rekaby",
      productManagerJiraAccountId: "acct-ali",
    } as never);

    const result = await resolveSquadPmRosterNames("ventures");

    expect(result.pmEmails).toEqual([]);
    expect(result.pmNames).toEqual(expect.arrayContaining(["Ali Rekaby", "Ahmed Sharaf"]));
    expect(result.pmAccountIds).toEqual(expect.arrayContaining(["acct-ali", "acct-sharaf"]));
  });

  it("still resolves User Management pmEmails when present", async () => {
    vi.mocked(prisma.squad.findUnique).mockResolvedValue({
      pmEmails: ["pm@example.com"],
    } as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);
    vi.mocked(readSquadJiraConfig).mockResolvedValue({
      assigneeMap: { "Hala Nagmeldin": "acct-hala" },
      productManagerName: "",
      productManagerJiraAccountId: "",
    } as never);
    vi.mocked(requireJiraApiCredentials).mockResolvedValue({
      email: "a@b.co",
      apiToken: "tok",
      siteUrl: "https://example.atlassian.net",
    } as never);
    vi.mocked(resolveEmJiraAccountId).mockResolvedValue("acct-hala");
    vi.mocked(searchJiraUsers).mockResolvedValue([
      { accountId: "acct-hala", displayName: "Hala Nagmeldin" },
    ]);

    const result = await resolveSquadPmRosterNames("ventures");

    expect(result.pmEmails).toEqual(["pm@example.com"]);
    expect(result.pmAccountIds).toContain("acct-hala");
    expect(result.pmNames).toEqual(expect.arrayContaining(["Hala Nagmeldin"]));
  });
});

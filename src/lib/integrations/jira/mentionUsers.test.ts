import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./userSearch", () => ({ searchJiraUsers: vi.fn() }));

import { rosterMentionSuggestions, suggestMentionUsers } from "./mentionUsers";
import { searchJiraUsers } from "./userSearch";
import { JiraApiError } from "./jiraErrors";

const credentials = { siteUrl: "https://example.atlassian.net", email: "me@example.com", apiToken: "token" };
const assigneeMap = { "Sara Adel": "acc-sara", "Omar Ali": "acc-omar", "No Account": "" };
const searchMock = vi.mocked(searchJiraUsers);

beforeEach(() => {
  searchMock.mockReset();
});

describe("rosterMentionSuggestions", () => {
  it("filters roster names case-insensitively and skips people without a Jira account", () => {
    expect(rosterMentionSuggestions(assigneeMap, "ali")).toEqual([
      { accountId: "acc-omar", displayName: "Omar Ali", onRoster: true },
    ]);
    expect(rosterMentionSuggestions(assigneeMap, "").map((person) => person.displayName)).toEqual([
      "Omar Ali",
      "Sara Adel",
    ]);
  });
});

describe("suggestMentionUsers", () => {
  it("does not call Jira for queries shorter than 2 characters", async () => {
    const result = await suggestMentionUsers(credentials, { assigneeMap }, "s");
    expect(searchMock).not.toHaveBeenCalled();
    expect(result.map((person) => person.accountId)).toEqual(["acc-sara"]);
  });

  it("lists roster first, then Jira users not already on the roster", async () => {
    searchMock.mockResolvedValue([
      { accountId: "acc-sara", displayName: "Sara Adel" },
      { accountId: "acc-sarah", displayName: "Sarah Nabil" },
    ]);
    const result = await suggestMentionUsers(credentials, { assigneeMap }, "sar");
    expect(result).toEqual([
      { accountId: "acc-sara", displayName: "Sara Adel", onRoster: true },
      { accountId: "acc-sarah", displayName: "Sarah Nabil", onRoster: false },
    ]);
  });

  it("caps the list at 10 people", async () => {
    searchMock.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => ({ accountId: `acc-${index}`, displayName: `Person ${index}` })),
    );
    expect(await suggestMentionUsers(credentials, { assigneeMap }, "person")).toHaveLength(10);
  });

  it("keeps roster matches when the Jira search fails, and throws when there are none", async () => {
    searchMock.mockRejectedValue(new JiraApiError("Jira down", 503));
    expect((await suggestMentionUsers(credentials, { assigneeMap }, "sara")).map((p) => p.accountId)).toEqual([
      "acc-sara",
    ]);
    await expect(suggestMentionUsers(credentials, { assigneeMap }, "zz")).rejects.toMatchObject({ status: 503 });
  });
});

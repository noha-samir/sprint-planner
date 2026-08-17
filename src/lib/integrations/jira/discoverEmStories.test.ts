import { describe, expect, it, vi } from "vitest";
import {
  buildEmStoryDiscoveryJql,
  discoverEmStoriesFromJira,
  existingIssueKeySet,
} from "./discoverEmStories";
import { jqlFieldRef } from "./jiraSearch";
import { defaultSquadJiraConfig } from "./types";

describe("jqlFieldRef", () => {
  it("maps customfield ids and names", () => {
    expect(jqlFieldRef("customfield_10123")).toBe("cf[10123]");
    expect(jqlFieldRef("10123")).toBe("cf[10123]");
    expect(jqlFieldRef("Engineering Manager")).toBe('"Engineering Manager"');
    expect(jqlFieldRef("")).toBeNull();
  });
});

describe("existingIssueKeySet", () => {
  it("collects keys from browse URLs and raw keys", () => {
    expect(
      existingIssueKeySet([
        "https://example.atlassian.net/browse/BR-1",
        "BR-2",
        "",
        "not-a-key",
      ]),
    ).toEqual(new Set(["BR-1", "BR-2"]));
  });
});

describe("buildEmStoryDiscoveryJql", () => {
  it("returns null without project or EM/squad fields", () => {
    expect(
      buildEmStoryDiscoveryJql({
        projectKey: "",
        engineeringManagerFieldId: "customfield_1",
        squadFieldId: "",
        squadOptionId: "",
      }),
    ).toBeNull();
    expect(
      buildEmStoryDiscoveryJql({
        projectKey: "BR",
        engineeringManagerFieldId: "",
        squadFieldId: "",
        squadOptionId: "",
      }),
    ).toBeNull();
  });

  it("filters by Engineering Manager currentUser and squad option", () => {
    expect(
      buildEmStoryDiscoveryJql({
        projectKey: "br",
        engineeringManagerFieldId: "customfield_10200",
        emAccountId: "acct-em",
        squadFieldId: "customfield_10001",
        squadOptionId: "10001",
      }),
    ).toBe(
      'project = "BR" AND issuetype not in subTaskIssueTypes() AND issuetype != Epic AND status != Discoped AND (cf[10200] = currentUser() OR cf[10200] = "acct-em") AND cf[10001] = "10001" ORDER BY key ASC',
    );
  });

  it("uses squad field alone when EM field is empty", () => {
    expect(
      buildEmStoryDiscoveryJql({
        projectKey: "BR",
        engineeringManagerFieldId: "",
        squadFieldId: "customfield_10001",
        squadOptionId: "10001",
      }),
    ).toBe(
      'project = "BR" AND issuetype not in subTaskIssueTypes() AND issuetype != Epic AND status != Discoped AND cf[10001] = "10001" ORDER BY key ASC',
    );
  });
});

describe("discoverEmStoriesFromJira", () => {
  it("skips keys already on the dashboard and subtask issue types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          issues: [
            { key: "BR-1", fields: { summary: "Already here" } },
            { key: "BR-2", fields: { summary: "New story", issuetype: { subtask: false } } },
            { key: "BR-3", fields: { summary: "Child", issuetype: { subtask: true } } },
          ],
        }),
      })),
    );
    const config = defaultSquadJiraConfig();
    config.projectKey = "BR";
    config.engineeringManagerFieldId = "customfield_10200";
    const result = await discoverEmStoriesFromJira(
      { siteUrl: "https://example.atlassian.net", email: "a@b.co", apiToken: "x" },
      config,
      new Set(["BR-1"]),
      "acct-em",
    );
    expect(result.stories).toEqual([
      {
        key: "BR-2",
        summary: "New story",
        storyLink: "https://example.atlassian.net/browse/BR-2",
      },
    ]);
    vi.unstubAllGlobals();
  });
});

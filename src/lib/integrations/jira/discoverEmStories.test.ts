import { describe, expect, it, vi } from "vitest";
import {
  buildEmStoryDiscoveryJql,
  discoverEmStoriesFromJira,
  EM_CARRYOVER_OPEN_STATUSES,
  emSprintAwareStoryClause,
  existingIssueKeySet,
} from "./discoverEmStories";
import { jqlFieldRef, quoteJql } from "./jiraSearch";
import { defaultSquadJiraConfig } from "./types";

const sprintAwareClause = emSprintAwareStoryClause();

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

describe("emSprintAwareStoryClause", () => {
  it("includes the current open sprint without an open-status filter", () => {
    const currentSprintSide = sprintAwareClause.slice(0, sprintAwareClause.indexOf(" OR "));
    expect(currentSprintSide).toContain("sprint in openSprints()");
    expect(currentSprintSide).not.toContain("status in");
  });

  it("limits closed-sprint leftovers to the open engineering statuses", () => {
    expect(sprintAwareClause).toContain("sprint in closedSprints()");
    for (const status of EM_CARRYOVER_OPEN_STATUSES) {
      expect(sprintAwareClause).toContain(quoteJql(status));
    }
    expect(sprintAwareClause).not.toContain(quoteJql("Production"));
    expect(sprintAwareClause).not.toContain(quoteJql("Done"));
    expect(sprintAwareClause).not.toContain(quoteJql("In Design"));
    expect(sprintAwareClause).not.toContain(quoteJql("Closed"));
    expect(sprintAwareClause).not.toContain(quoteJql("Cancelled"));
  });
});

describe("buildEmStoryDiscoveryJql", () => {
  it("returns null without project or when Squad config is incomplete", () => {
    expect(
      buildEmStoryDiscoveryJql({
        projectKey: "",
        squadFieldId: "customfield_10001",
        squadOptionId: "10001",
      }),
    ).toBeNull();
    expect(
      buildEmStoryDiscoveryJql({
        projectKey: "BR",
        squadFieldId: "",
        squadOptionId: "",
      }),
    ).toBeNull();
    expect(
      buildEmStoryDiscoveryJql({
        projectKey: "BR",
        squadFieldId: "customfield_10001",
        squadOptionId: "",
      }),
    ).toBeNull();
  });

  it("filters by squad option only", () => {
    expect(
      buildEmStoryDiscoveryJql({
        projectKey: "br",
        squadFieldId: "customfield_10001",
        squadOptionId: "10001",
      }),
    ).toBe(
      `project = "BR" AND issuetype not in subTaskIssueTypes() AND issuetype != Epic AND status != Discoped AND ${sprintAwareClause} AND cf[10001] = "10001" ORDER BY key ASC`,
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
    config.subtaskSquadFieldId = "customfield_10001";
    config.subtaskSquadOptionId = "10001";
    const result = await discoverEmStoriesFromJira(
      { siteUrl: "https://example.atlassian.net", email: "a@b.co", apiToken: "x" },
      config,
      new Set(["BR-1"]),
    );
    expect(result.stories).toEqual([
      {
        key: "BR-2",
        summary: "New story",
        storyLink: "https://example.atlassian.net/browse/BR-2",
        issueType: undefined,
        assigneeAccountId: null,
        estimateSeconds: null,
      },
    ]);
    vi.unstubAllGlobals();
  });
});

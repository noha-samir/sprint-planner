import { beforeEach, describe, expect, it, vi } from "vitest";
import { jqlFieldRef, quoteJql, searchJqlIssues } from "./jiraSearch";

vi.mock("./credentials", async () => {
  const actual = await vi.importActual<typeof import("./credentials")>("./credentials");
  return {
    ...actual,
    jiraRestApiBase: () => "https://test.atlassian.net/rest/api/3",
    buildJiraBasicAuthHeader: () => "Basic xxx",
  };
});

describe("quoteJql", () => {
  it("escapes embedded quotes", () => {
    expect(quoteJql('Say "hi"')).toBe('"Say \\"hi\\""');
  });
});

describe("jqlFieldRef", () => {
  it("accepts cf[id] and rejects empty or unsafe names", () => {
    expect(jqlFieldRef("cf[10123]")).toBe("cf[10123]");
    expect(jqlFieldRef("customfield_9")).toBe("cf[9]");
    expect(jqlFieldRef("bad; DROP")).toBeNull();
  });
});

describe("searchJqlIssues", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("pages through POST /search/jql until nextPageToken is gone", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { nextPageToken?: string };
      if (!body.nextPageToken) {
        return {
          ok: true,
          json: async () => ({ issues: [{ key: "BR-1" }], nextPageToken: "page-2" }),
        };
      }
      return {
        ok: true,
        json: async () => ({ issues: [{ key: "BR-2" }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const issues = await searchJqlIssues(
      { siteUrl: "https://test.atlassian.net", email: "a@b.co", apiToken: "x" },
      'project = "BR"',
      50,
    );
    expect(issues?.map((issue) => issue.key)).toEqual(["BR-1", "BR-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("returns null when the first page fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        text: async () => "nope",
      })),
    );
    await expect(
      searchJqlIssues(
        { siteUrl: "https://test.atlassian.net", email: "a@b.co", apiToken: "x" },
        'project = "BR"',
        50,
      ),
    ).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});

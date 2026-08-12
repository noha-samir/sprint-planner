import { describe, expect, it } from "vitest";
import { buildJiraBasicAuthHeader, normalizeJiraSiteUrl } from "./credentials";

describe("normalizeJiraSiteUrl", () => {
  it("adds https when missing", () => {
    expect(normalizeJiraSiteUrl("example.atlassian.net")).toBe("https://example.atlassian.net");
  });

  it("strips trailing slash", () => {
    expect(normalizeJiraSiteUrl("https://example.atlassian.net/")).toBe("https://example.atlassian.net");
  });
});

describe("buildJiraBasicAuthHeader", () => {
  it("builds Basic auth header", () => {
    const header = buildJiraBasicAuthHeader({
      siteUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "secret",
    });
    expect(header).toMatch(/^Basic /);
  });
});

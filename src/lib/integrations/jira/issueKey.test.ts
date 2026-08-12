import { describe, expect, it } from "vitest";
import {
  buildJiraIssueBrowseUrl,
  isJiraStoryLink,
  issueNumberFromIssueKey,
  parseJiraIssueKey,
  parseJiraIssueNumber,
  projectKeyFromIssueKey,
} from "./issueKey";

describe("parseJiraIssueKey", () => {
  it("parses bare issue keys", () => {
    expect(parseJiraIssueKey("VEN-123")).toBe("VEN-123");
  });

  it("parses browse URLs", () => {
    expect(parseJiraIssueKey("https://example.atlassian.net/browse/ven-45")).toBe("VEN-45");
  });

  it("returns null for non-jira links", () => {
    expect(parseJiraIssueKey("https://example.com")).toBeNull();
  });
});

describe("isJiraStoryLink", () => {
  it("detects jira links", () => {
    expect(isJiraStoryLink("https://example.atlassian.net/browse/VEN-1")).toBe(true);
    expect(isJiraStoryLink("not-a-link")).toBe(false);
  });
});

describe("projectKeyFromIssueKey", () => {
  it("extracts project key", () => {
    expect(projectKeyFromIssueKey("VEN-99")).toBe("VEN");
  });
});

describe("issueNumberFromIssueKey", () => {
  it("extracts issue number", () => {
    expect(issueNumberFromIssueKey("VEN-99")).toBe(99);
    expect(parseJiraIssueNumber("https://example.atlassian.net/browse/VEN-1")).toBe(1);
  });
});

describe("buildJiraIssueBrowseUrl", () => {
  it("builds browse URLs from parent story links", () => {
    expect(buildJiraIssueBrowseUrl("https://example.atlassian.net/browse/VEN-1", "VEN-2")).toBe(
      "https://example.atlassian.net/browse/VEN-2",
    );
  });
});

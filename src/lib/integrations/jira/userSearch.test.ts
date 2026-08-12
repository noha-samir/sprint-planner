import { describe, expect, it } from "vitest";
import { describeUnresolvedPlannerName, pickJiraAccountIdForPlannerName } from "./userSearch";

describe("pickJiraAccountIdForPlannerName", () => {
  it("uses the only search result", () => {
    expect(
      pickJiraAccountIdForPlannerName("lee", [{ accountId: "acc-1", displayName: "Jordan Lee" }]),
    ).toBe("acc-1");
  });

  it("matches a name token inside displayName", () => {
    expect(
      pickJiraAccountIdForPlannerName("Casey", [
        { accountId: "acc-1", displayName: "Casey Morgan" },
        { accountId: "acc-2", displayName: "Sam Lee" },
      ]),
    ).toBe("acc-1");
  });

  it("returns null when multiple users match ambiguously", () => {
    expect(
      pickJiraAccountIdForPlannerName("Alex", [
        { accountId: "acc-1", displayName: "Alex Rivera" },
        { accountId: "acc-2", displayName: "Alex Kim" },
      ]),
    ).toBeNull();
  });
});

describe("describeUnresolvedPlannerName", () => {
  it("warns when Jira has no account for the name", () => {
    expect(describeUnresolvedPlannerName("Ghost", [])).toBe('No Jira account found for "Ghost"');
  });

  it("warns when multiple accounts match", () => {
    expect(
      describeUnresolvedPlannerName("Riley", [
        { accountId: "a", displayName: "Riley Chen" },
        { accountId: "b", displayName: "Riley Park" },
      ]),
    ).toContain("Multiple Jira accounts match");
    expect(
      describeUnresolvedPlannerName("Riley", [
        { accountId: "a", displayName: "Riley Chen" },
        { accountId: "b", displayName: "Riley Park" },
      ]),
    ).toContain("Jira Integration");
  });

  it("warns when an account exists but is not mapped", () => {
    expect(
      describeUnresolvedPlannerName("Casey", [{ accountId: "acc-1", displayName: "Casey Morgan" }]),
    ).toContain("Jira Integration");
  });
});

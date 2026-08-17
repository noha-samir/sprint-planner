import { describe, expect, it } from "vitest";
import { JIRA_SYNC_ADDED_TAG } from "./jiraSyncTag";

describe("JIRA_SYNC_ADDED_TAG", () => {
  it("is the tag applied to stories imported by Pull from Jira", () => {
    expect(JIRA_SYNC_ADDED_TAG).toBe("Jira sync");
  });
});

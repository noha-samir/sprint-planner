import { describe, expect, it } from "vitest";
import { JIRA_NEEDS_PUSH_TAG, JIRA_SYNC_ADDED_TAG, withoutLegacyNeedsPushTag } from "./jiraSyncTag";

describe("JIRA_SYNC_ADDED_TAG", () => {
  it("is the tag applied to stories imported by Pull from Jira", () => {
    expect(JIRA_SYNC_ADDED_TAG).toBe("Jira sync");
  });
});

describe("withoutLegacyNeedsPushTag", () => {
  it("removes the legacy Needs push tag and keeps the rest", () => {
    expect(withoutLegacyNeedsPushTag(["Jira sync", JIRA_NEEDS_PUSH_TAG, "Hotfix"])).toEqual(["Jira sync", "Hotfix"]);
  });

  it("returns the same reference when the tag is absent", () => {
    const tags = ["Jira sync"];
    expect(withoutLegacyNeedsPushTag(tags)).toBe(tags);
    expect(withoutLegacyNeedsPushTag(undefined)).toBeUndefined();
  });
});

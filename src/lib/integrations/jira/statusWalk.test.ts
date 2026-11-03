import { describe, expect, it } from "vitest";
import { formatJiraStatusJumpWarning, jiraStatusJump } from "./statusWalk";

describe("jiraStatusJump", () => {
  it("treats Ready for Review → Production as a jump", () => {
    expect(jiraStatusJump("Ready for Review", "Production")).toEqual({
      fromStatus: "Ready for Review",
      toStatus: "Production",
    });
  });

  it("leaves a single forward step alone", () => {
    expect(jiraStatusJump("In Progress", "Ready for Review")).toBeNull();
    expect(jiraStatusJump("Ready for Production", "Production")).toBeNull();
  });

  it("leaves same, backward, and off-path statuses alone", () => {
    expect(jiraStatusJump("Production", "Production")).toBeNull();
    expect(jiraStatusJump("Ready for Testing", "In Progress")).toBeNull();
    expect(jiraStatusJump("Done", "Production")).toBeNull();
    expect(jiraStatusJump("Ready for Review", "Cancelled")).toBeNull();
  });
});

describe("formatJiraStatusJumpWarning", () => {
  it("asks to accept the jump and names each story", () => {
    const message = formatJiraStatusJumpWarning([
      { storyName: "Live tracking", fromStatus: "Ready for Review", toStatus: "Production" },
    ]);
    expect(message).toContain("Status jump.");
    expect(message).toContain("Accept to continue.");
    expect(message).toContain("• Live tracking — Ready for Review → Production");
  });

  it("returns null when nothing jumps", () => {
    expect(formatJiraStatusJumpWarning([])).toBeNull();
  });
});

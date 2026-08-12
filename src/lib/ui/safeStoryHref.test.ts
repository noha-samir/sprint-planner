import { describe, expect, it } from "vitest";
import { safeStoryHref } from "./safeStoryHref";

describe("safeStoryHref", () => {
  it("returns empty for blank input", () => {
    expect(safeStoryHref("")).toBe("");
    expect(safeStoryHref("   ")).toBe("");
  });

  it("allows http and https URLs", () => {
    expect(safeStoryHref("https://jira.example.com/browse/ABC-1")).toBe(
      "https://jira.example.com/browse/ABC-1",
    );
    expect(safeStoryHref("http://example.com/x")).toBe("http://example.com/x");
  });

  it("prefixes bare hosts with https", () => {
    expect(safeStoryHref("jira.example.com/browse/ABC-1")).toBe(
      "https://jira.example.com/browse/ABC-1",
    );
  });

  it("rejects non-http schemes", () => {
    expect(safeStoryHref("javascript:alert(1)")).toBe("");
    expect(safeStoryHref("data:text/html,hi")).toBe("");
  });
});

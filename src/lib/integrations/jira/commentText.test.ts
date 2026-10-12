import { describe, expect, it } from "vitest";
import { findActiveMentionQuery, formatCommentTime, mentionsUsedInText, splitTextByMentions } from "./commentText";

const sara = { accountId: "acc-sara", displayName: "Sara Adel" };
const omar = { accountId: "acc-omar", displayName: "Omar" };

describe("splitTextByMentions", () => {
  it("splits mentions out and joins back to the same text", () => {
    const text = "cc @Sara Adel, @Omar.";
    const segments = splitTextByMentions(text, [sara, omar]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segments.filter((segment) => segment.mention).map((segment) => segment.mention?.accountId)).toEqual([
      "acc-sara",
      "acc-omar",
    ]);
  });
});

describe("mentionsUsedInText", () => {
  it("drops picked people whose @name was erased", () => {
    expect(mentionsUsedInText("thanks @Omar", [sara, omar])).toEqual([omar]);
  });
});

describe("findActiveMentionQuery", () => {
  it("finds the @query before the caret, including full names", () => {
    expect(findActiveMentionQuery("hi @Sara Ad", 11)).toEqual({ start: 3, query: "Sara Ad" });
    expect(findActiveMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("ignores e-mails, line breaks and finished words", () => {
    expect(findActiveMentionQuery("me@example.com", 14)).toBeNull();
    expect(findActiveMentionQuery("@Sara\nnext", 10)).toBeNull();
    expect(findActiveMentionQuery("@Sara  done", 11)).toBeNull();
    expect(findActiveMentionQuery("no mention", 10)).toBeNull();
  });
});

describe("formatCommentTime", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");

  it("shows relative times for recent comments", () => {
    expect(formatCommentTime("2026-10-10T11:59:30Z", now)).toBe("just now");
    expect(formatCommentTime("2026-10-10T11:55:00Z", now)).toMatch(/5 minutes ago/);
    expect(formatCommentTime("2026-10-10T09:00:00Z", now)).toMatch(/3 hours ago/);
  });

  it("returns empty for invalid dates", () => {
    expect(formatCommentTime("not a date", now)).toBe("");
  });
});

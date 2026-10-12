import { describe, expect, it } from "vitest";
import { jiraCommentIdSchema, jiraCommentWriteSchema } from "./apiBodies";

describe("jiraCommentWriteSchema", () => {
  it("accepts text with mentions and defaults mentions to an empty list", () => {
    expect(jiraCommentWriteSchema.parse({ text: "  hi  " })).toEqual({ text: "hi", mentions: [] });
    expect(
      jiraCommentWriteSchema.parse({ text: "@Sara hi", mentions: [{ accountId: "acc-1", displayName: "Sara" }] })
        .mentions,
    ).toHaveLength(1);
  });

  it("rejects blank or too long text", () => {
    expect(jiraCommentWriteSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(jiraCommentWriteSchema.safeParse({ text: "a".repeat(5001) }).success).toBe(false);
    expect(jiraCommentWriteSchema.safeParse({ text: "a".repeat(5000) }).success).toBe(true);
  });

  it("rejects more than 20 mentions or mentions without an account id", () => {
    const mentions = Array.from({ length: 21 }, (_, index) => ({ accountId: `acc-${index}`, displayName: "X" }));
    expect(jiraCommentWriteSchema.safeParse({ text: "hi", mentions }).success).toBe(false);
    expect(
      jiraCommentWriteSchema.safeParse({ text: "hi", mentions: [{ accountId: " ", displayName: "X" }] }).success,
    ).toBe(false);
  });
});

describe("jiraCommentIdSchema", () => {
  it("accepts numeric Jira comment ids only", () => {
    expect(jiraCommentIdSchema.safeParse("10234").success).toBe(true);
    expect(jiraCommentIdSchema.safeParse("../myself").success).toBe(false);
    expect(jiraCommentIdSchema.safeParse("").success).toBe(false);
  });
});

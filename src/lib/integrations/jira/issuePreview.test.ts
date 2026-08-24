import { describe, expect, it } from "vitest";
import {
  jiraDescriptionToPlainText,
  truncateDescriptionPreview,
} from "./issuePreview";

describe("jiraDescriptionToPlainText", () => {
  it("walks ADF docs into plain text with paragraph breaks", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "First line" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second line" }],
        },
      ],
    };
    expect(jiraDescriptionToPlainText(adf)).toBe("First line\nSecond line");
  });

  it("strips HTML tags and keeps line breaks", () => {
    expect(jiraDescriptionToPlainText("<p>Hello</p><br/>World")).toBe("Hello\nWorld");
  });

  it("returns empty for null/undefined", () => {
    expect(jiraDescriptionToPlainText(null)).toBe("");
    expect(jiraDescriptionToPlainText(undefined)).toBe("");
  });
});

describe("truncateDescriptionPreview", () => {
  it("keeps the first lines and max characters with ellipsis", () => {
    const text = ["one", "two", "three", "four", "five"].join("\n");
    expect(truncateDescriptionPreview(text, 4, 320)).toBe("one\ntwo\nthree\nfour…");
    expect(truncateDescriptionPreview("a".repeat(400), 4, 320).endsWith("…")).toBe(true);
    expect(truncateDescriptionPreview("a".repeat(400), 4, 320).length).toBe(321);
  });

  it("returns short text unchanged", () => {
    expect(truncateDescriptionPreview("Short note")).toBe("Short note");
  });
});

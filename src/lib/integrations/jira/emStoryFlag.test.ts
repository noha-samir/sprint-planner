import { describe, expect, it } from "vitest";
import { resolveIsEmStory } from "./emStoryFlag";

describe("resolveIsEmStory", () => {
  it("matches assignee or engineering manager field account id", () => {
    expect(resolveIsEmStory("em-1", "em-1", null)).toBe(true);
    expect(resolveIsEmStory("em-1", "dev-1", "em-1")).toBe(true);
    expect(resolveIsEmStory("em-1", "dev-1", "dev-2")).toBe(false);
    expect(resolveIsEmStory(null, "em-1", "em-1")).toBe(false);
  });
});

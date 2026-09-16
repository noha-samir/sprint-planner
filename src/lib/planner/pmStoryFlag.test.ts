import { describe, expect, it } from "vitest";
import { isOwnerPmStory, isSquadPmStory, resolveIsPmStory } from "./pmStoryFlag";

describe("resolveIsPmStory", () => {
  it("matches Jira assignee against any squad PM account id", () => {
    expect(resolveIsPmStory(["pm-1", "pm-2"], "pm-2")).toBe(true);
    expect(resolveIsPmStory(["pm-1"], "dev-1")).toBe(false);
    expect(resolveIsPmStory([], "pm-1")).toBe(false);
    expect(resolveIsPmStory(["pm-1"], null)).toBe(false);
    expect(resolveIsPmStory(null, "pm-1")).toBe(false);
  });
});

describe("isSquadPmStory", () => {
  it("matches at least one product manager against squad PM names (case-insensitive)", () => {
    expect(isSquadPmStory(["Alex Rivera"], ["alex rivera"])).toBe(true);
    expect(isSquadPmStory(["Alex Rivera", "Other"], ["Other PM", "alex rivera"])).toBe(true);
    expect(isSquadPmStory(["Dev"], ["Alex Rivera"])).toBe(false);
  });

  it("is false when either list is empty or missing", () => {
    expect(isSquadPmStory([], ["Alex"])).toBe(false);
    expect(isSquadPmStory(["Alex"], [])).toBe(false);
    expect(isSquadPmStory(undefined, ["Alex"])).toBe(false);
    expect(isSquadPmStory(["Alex"], undefined)).toBe(false);
  });
});

describe("isOwnerPmStory", () => {
  it("is true when isPmStory flag is set even without productManagers", () => {
    expect(isOwnerPmStory({ isPmStory: true, productManagers: [] }, ["Hala"])).toBe(true);
  });

  it("falls back to productManagers name match", () => {
    expect(isOwnerPmStory({ isPmStory: false, productManagers: ["Hala"] }, ["hala"])).toBe(true);
    expect(isOwnerPmStory({ productManagers: ["Dev"] }, ["Hala"])).toBe(false);
  });
});

/** Owner filter matrix used by TaskTable (All / EM / Team / PM). */
function matchesOwnerFilter(
  filter: "all" | "em" | "non-em" | "pm",
  isEmStory: boolean,
  task: { isPmStory?: boolean; productManagers?: string[] },
  squadPmNames: string[],
): boolean {
  const pmStory = isOwnerPmStory(task, squadPmNames);
  if (filter === "all") return true;
  if (filter === "em") return isEmStory;
  if (filter === "pm") return pmStory;
  if (filter === "non-em") return !isEmStory && !pmStory;
  return true;
}

describe("owner filter matrix", () => {
  const pmNames = ["Hala"];

  it("EM-only story appears in EM, not Team or PM", () => {
    expect(matchesOwnerFilter("em", true, {}, pmNames)).toBe(true);
    expect(matchesOwnerFilter("pm", true, {}, pmNames)).toBe(false);
    expect(matchesOwnerFilter("non-em", true, {}, pmNames)).toBe(false);
  });

  it("assignee-PM story appears in PM via isPmStory", () => {
    expect(matchesOwnerFilter("pm", false, { isPmStory: true }, pmNames)).toBe(true);
    expect(matchesOwnerFilter("em", false, { isPmStory: true }, pmNames)).toBe(false);
    expect(matchesOwnerFilter("non-em", false, { isPmStory: true }, pmNames)).toBe(false);
  });

  it("PM-column story appears in PM via productManagers", () => {
    expect(matchesOwnerFilter("pm", false, { productManagers: ["Hala"] }, pmNames)).toBe(true);
    expect(matchesOwnerFilter("non-em", false, { productManagers: ["Hala"] }, pmNames)).toBe(false);
  });

  it("EM+PM story is excluded from Team but included in EM and PM", () => {
    expect(matchesOwnerFilter("em", true, { isPmStory: true }, pmNames)).toBe(true);
    expect(matchesOwnerFilter("pm", true, { isPmStory: true }, pmNames)).toBe(true);
    expect(matchesOwnerFilter("non-em", true, { isPmStory: true }, pmNames)).toBe(false);
  });

  it("neither EM nor PM appears in Team only", () => {
    expect(matchesOwnerFilter("non-em", false, { productManagers: ["Someone Else"] }, pmNames)).toBe(true);
    expect(matchesOwnerFilter("em", false, { productManagers: ["Someone Else"] }, pmNames)).toBe(false);
    expect(matchesOwnerFilter("pm", false, { productManagers: ["Someone Else"] }, pmNames)).toBe(false);
  });
});

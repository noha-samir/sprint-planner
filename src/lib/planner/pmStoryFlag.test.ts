import { describe, expect, it } from "vitest";
import { isSquadPmStory } from "./pmStoryFlag";

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

/** Owner filter matrix used by TaskTable (All / EM / Team / PM). */
function matchesOwnerFilter(
  filter: "all" | "em" | "non-em" | "pm",
  isEmStory: boolean,
  productManagers: string[],
  squadPmNames: string[],
): boolean {
  const pmStory = isSquadPmStory(productManagers, squadPmNames);
  if (filter === "all") return true;
  if (filter === "em") return isEmStory;
  if (filter === "pm") return pmStory;
  if (filter === "non-em") return !isEmStory && !pmStory;
  return true;
}

describe("owner filter matrix", () => {
  const pmNames = ["Hala"];

  it("EM-only story appears in EM, not Team or PM", () => {
    expect(matchesOwnerFilter("em", true, [], pmNames)).toBe(true);
    expect(matchesOwnerFilter("pm", true, [], pmNames)).toBe(false);
    expect(matchesOwnerFilter("non-em", true, [], pmNames)).toBe(false);
  });

  it("PM-only story appears in PM, not Team or EM", () => {
    expect(matchesOwnerFilter("pm", false, ["Hala"], pmNames)).toBe(true);
    expect(matchesOwnerFilter("em", false, ["Hala"], pmNames)).toBe(false);
    expect(matchesOwnerFilter("non-em", false, ["Hala"], pmNames)).toBe(false);
  });

  it("EM+PM story is excluded from Team but included in EM and PM", () => {
    expect(matchesOwnerFilter("em", true, ["Hala"], pmNames)).toBe(true);
    expect(matchesOwnerFilter("pm", true, ["Hala"], pmNames)).toBe(true);
    expect(matchesOwnerFilter("non-em", true, ["Hala"], pmNames)).toBe(false);
  });

  it("neither EM nor PM appears in Team only", () => {
    expect(matchesOwnerFilter("non-em", false, ["Someone Else"], pmNames)).toBe(true);
    expect(matchesOwnerFilter("em", false, ["Someone Else"], pmNames)).toBe(false);
    expect(matchesOwnerFilter("pm", false, ["Someone Else"], pmNames)).toBe(false);
  });
});

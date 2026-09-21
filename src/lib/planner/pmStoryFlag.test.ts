import { describe, expect, it } from "vitest";
import {
  expandSquadPmMatchNames,
  isOwnerPmStory,
  isSquadPmStory,
  resolveIsPmStory,
} from "./pmStoryFlag";

describe("resolveIsPmStory", () => {
  it("matches Jira assignee against any squad PM account id", () => {
    expect(resolveIsPmStory(["pm-1", "pm-2"], "pm-2")).toBe(true);
    expect(resolveIsPmStory(["pm-1"], "dev-1")).toBe(false);
    expect(resolveIsPmStory([], "pm-1")).toBe(false);
    expect(resolveIsPmStory(["pm-1"], null)).toBe(false);
    expect(resolveIsPmStory(null, "pm-1")).toBe(false);
  });
});

describe("expandSquadPmMatchNames", () => {
  it("adds nicknames for matching PM roster people", () => {
    expect(
      expandSquadPmMatchNames(["Hala Ahmed"], [
        { name: "Hala Ahmed", nickname: "Hala", type: "PM" },
        { name: "Other PM", nickname: "O", type: "PM" },
      ]),
    ).toEqual(expect.arrayContaining(["Hala Ahmed", "Hala"]));
  });

  it("falls back to PM roster when API names are empty", () => {
    expect(
      expandSquadPmMatchNames([], [
        { name: "Ali Rekaby", nickname: null, type: "PM" },
        { name: "Dev", nickname: null, type: "FE" },
      ]),
    ).toEqual(["Ali Rekaby"]);
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
  const pmNames = ["Ali Rekaby"];
  const resources = [{ name: "Ali Rekaby", nickname: null, type: "PM" }];

  it("is true when Jira assignee is a squad PM", () => {
    expect(isOwnerPmStory({ isPmStory: true, productManagers: [] }, pmNames, resources)).toBe(true);
  });

  it("is true when a Story lists a squad PM in Product Managers", () => {
    expect(
      isOwnerPmStory(
        { isPmStory: false, productManagers: ["Ali Rekaby"], issueType: "Story" },
        pmNames,
        resources,
      ),
    ).toBe(true);
    expect(
      isOwnerPmStory(
        { productManagers: ["Ali Rekaby"] },
        pmNames,
        resources,
      ),
    ).toBe(true);
  });

  it("matches Product Managers via PM roster even when API names are empty", () => {
    expect(
      isOwnerPmStory(
        { productManagers: ["Ali Rekaby"], issueType: "Story" },
        [],
        [{ name: "Ali Rekaby", nickname: null, type: "PM" }],
      ),
    ).toBe(true);
  });

  it("ignores Product Managers on technical tasks / bugs unless assignee is PM", () => {
    expect(
      isOwnerPmStory(
        {
          isPmStory: false,
          productManagers: ["Ali Rekaby"],
          issueType: "Technical Task",
        },
        pmNames,
        resources,
      ),
    ).toBe(false);
    expect(
      isOwnerPmStory(
        {
          isPmStory: true,
          productManagers: ["Ali Rekaby"],
          issueType: "Technical Task",
        },
        pmNames,
        resources,
      ),
    ).toBe(true);
  });
});

/** Owner filter matrix used by TaskTable (All / EM / Team / PM). */
function matchesOwnerFilter(
  filter: "all" | "em" | "non-em" | "pm",
  isEmStory: boolean,
  task: { isPmStory?: boolean; productManagers?: string[]; issueType?: string },
  squadPmNames: string[],
): boolean {
  const pmStory = isOwnerPmStory(task, squadPmNames);
  if (filter === "all") return true;
  if (filter === "em") return isEmStory;
  if (filter === "pm") return pmStory && !isEmStory;
  if (filter === "non-em") return !isEmStory && !pmStory;
  return true;
}

describe("owner filter matrix", () => {
  const pmNames = ["Ali Rekaby"];

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

  it("Story with Rekaby as Product Manager appears in PM", () => {
    expect(
      matchesOwnerFilter(
        "pm",
        false,
        { productManagers: ["Ali Rekaby"], issueType: "Story" },
        pmNames,
      ),
    ).toBe(true);
  });

  it("technical task with Rekaby as Product Manager stays out of PM", () => {
    expect(
      matchesOwnerFilter(
        "pm",
        false,
        { productManagers: ["Ali Rekaby"], issueType: "Technical Task" },
        pmNames,
      ),
    ).toBe(false);
    expect(
      matchesOwnerFilter(
        "non-em",
        false,
        { productManagers: ["Ali Rekaby"], issueType: "Technical Task" },
        pmNames,
      ),
    ).toBe(true);
  });

  it("EM+PM story stays under EM only (not PM or Team)", () => {
    expect(matchesOwnerFilter("em", true, { isPmStory: true }, pmNames)).toBe(true);
    expect(matchesOwnerFilter("pm", true, { isPmStory: true }, pmNames)).toBe(false);
    expect(matchesOwnerFilter("non-em", true, { isPmStory: true }, pmNames)).toBe(false);
  });
});

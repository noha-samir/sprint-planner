import { describe, expect, it } from "vitest";
import {
  coerceAssigneeNamesToRoster,
  coerceAssigneesForRole,
  isBlockedEngineeringAssignee,
  matchPlannerPerson,
  matchResourceByAssigneeLabel,
  resourceDisplayName,
} from "./resourceIdentity";
import type { Resource } from "@/lib/scheduler/types";

const resources: Resource[] = [
  { name: "Alex Rivera", type: "BE" },
  { name: "Riley Chen", type: "QC" },
  { name: "Sam Lee", type: "FE" },
];

describe("resourceIdentity", () => {
  it("uses roster name for display (Jira name)", () => {
    expect(resourceDisplayName(resources[0])).toBe("Alex Rivera");
    expect(resourceDisplayName(resources[1])).toBe("Riley Chen");
  });

  it("matches Jira full names onto roster names", () => {
    expect(matchPlannerPerson("Alex Rivera", resources)?.name).toBe("Alex Rivera");
    expect(matchPlannerPerson("Riley Chen", resources)?.name).toBe("Riley Chen");
  });

  it("coerces orphan assignee labels onto the roster", () => {
    expect(coerceAssigneeNamesToRoster(["Alex Rivera", "Someone"], resources)).toEqual([
      "Alex Rivera",
      "Someone",
    ]);
  });

  it("strips roster PMs from engineering role slots", () => {
    const roster: Resource[] = [
      ...resources,
      { name: "Morgan Price", type: "PM" },
      { name: "Hala", type: "PM" },
    ];
    expect(
      coerceAssigneesForRole(["Morgan Price", "Sam Lee", "Hala"], roster, ["FE"]),
    ).toEqual(["Sam Lee"]);
    expect(isBlockedEngineeringAssignee("Morgan Price", roster)).toBe(true);
  });

  it("only blocks people the roster types as PM (no hard-coded names)", () => {
    expect(isBlockedEngineeringAssignee("Morgan Price", [{ name: "Morgan Price", type: "FE" }])).toBe(false);
    expect(isBlockedEngineeringAssignee("Unknown Person", resources)).toBe(false);
  });

  it("matchResourceByAssigneeLabel finds resources by name", () => {
    expect(matchResourceByAssigneeLabel("Sam Lee", resources)?.name).toBe("Sam Lee");
  });
});

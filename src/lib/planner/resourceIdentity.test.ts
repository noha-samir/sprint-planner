import { describe, expect, it } from "vitest";
import {
  coerceAssigneeNamesToRoster,
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

  it("matchResourceByAssigneeLabel finds resources by name", () => {
    expect(matchResourceByAssigneeLabel("Sam Lee", resources)?.name).toBe("Sam Lee");
  });
});

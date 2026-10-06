import { describe, expect, it } from "vitest";
import {
  coerceAssigneeNamesToRoster,
  coerceAssigneesForRole,
  formatSubtaskAssigneesOutsideRole,
  isBlockedEngineeringAssignee,
  subtaskAssigneesOutsideRole,
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

describe("subtaskAssigneesOutsideRole", () => {
  const roster: Resource[] = [
    { name: "Mohamed Elkholaey", type: "BE" },
    { name: "Silvia Hassan", type: "OtherSquad" },
  ];
  const jira = (subtasks: Array<{ role: "fe" | "be" | "android" | "ios"; assigneeName: string }>) => ({
    parentIssueKey: "BR-1",
    lastPushedAt: null,
    lastPulledAt: null,
    subtasks: subtasks.map((row, index) => ({ key: `BR-${index + 2}`, hours: 2, ...row })),
  });

  it("lists an Other squad dev on a BE subtask, once, with a readable warning", () => {
    const skipped = subtaskAssigneesOutsideRole(
      {
        issueType: "Story",
        jira: jira([
          { role: "be", assigneeName: "Mohamed Elkholaey" },
          { role: "be", assigneeName: "Silvia Hassan" },
          { role: "be", assigneeName: "Silvia Hassan" },
        ]),
      },
      roster,
    );
    expect(skipped).toEqual([{ name: "Silvia Hassan", role: "be", type: "OtherSquad" }]);
    expect(formatSubtaskAssigneesOutsideRole(skipped)).toEqual([
      "Silvia Hassan (Other squad) has a BE subtask in Jira — not added to BE",
    ]);
  });

  it("ignores people not on the roster and Technical Tasks", () => {
    expect(
      subtaskAssigneesOutsideRole({ issueType: "Story", jira: jira([{ role: "be", assigneeName: "Unknown Dev" }]) }, roster),
    ).toEqual([]);
    expect(
      subtaskAssigneesOutsideRole(
        { issueType: "Technical Task", jira: jira([{ role: "be", assigneeName: "Silvia Hassan" }]) },
        roster,
      ),
    ).toEqual([]);
  });
});

describe("subtaskAssigneesOutsideRole", () => {
  const roster: Resource[] = [
    { name: "Mohamed Elkholaey", type: "BE" },
    { name: "Silvia Hassan", type: "OtherSquad" },
  ];
  const jira = (issueType: string) => ({
    issueType,
    jira: {
      parentIssueKey: "BR-1",
      lastPushedAt: null,
      lastPulledAt: null,
      subtasks: [
        { key: "BR-2", role: "be" as const, assigneeName: "Mohamed Elkholaey", hours: 6 },
        { key: "BR-3", role: "be" as const, assigneeName: "Silvia Hassan", hours: 5 },
        { key: "BR-4", role: "be" as const, assigneeName: "Silvia Hassan", hours: 1 },
        { key: "BR-5", role: "fe" as const, assigneeName: "Not On Roster", hours: 2 },
      ],
    },
  });

  it("lists roster people the role does not allow, once per role", () => {
    const skipped = subtaskAssigneesOutsideRole(jira("Story"), roster);
    expect(skipped).toEqual([{ name: "Silvia Hassan", role: "be", type: "OtherSquad" }]);
    expect(formatSubtaskAssigneesOutsideRole(skipped)).toEqual([
      "Silvia Hassan (Other squad) has a BE subtask in Jira — not added to BE",
    ]);
  });

  it("skips Technical Tasks, which never keep FE/BE people", () => {
    expect(subtaskAssigneesOutsideRole(jira("Technical Task"), roster)).toEqual([]);
  });
});

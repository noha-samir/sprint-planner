import { describe, expect, it } from "vitest";
import { keepNewestPerSquad } from "./retention";
import type { SprintHistoryEntry } from "./types";

const makeEntry = (id: string, squadId: string): SprintHistoryEntry => ({
  id,
  squadId,
  archivedAt: `2026-05-${id.padStart(2, "0")}T10:00:00.000Z`,
  sprintStartDate: "2026-05-01",
  planningSunday: "2026-05-03",
  tasks: [],
  resources: [],
  config: {
    sprintStartDate: "2026-05-01",
    planningSunday: "2026-05-03",
    extraHolidays: [],
    hoursPerDay: 8,
    sprintWorkingDays: 10,
    theme: "ocean",
  },
  summary: { totalTasks: 0, carryOverTasks: 0, totalResources: 0 },
});

describe("history retention", () => {
  it("keeps only newest limit entries for targeted squad", () => {
    const entries = Array.from({ length: 8 }, (_, idx) => makeEntry(String(idx + 1), "ventures"));
    const next = keepNewestPerSquad(entries, "ventures", 6);
    expect(next).toHaveLength(6);
    expect(next.map((item) => item.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("preserves entries from other squads", () => {
    const mixed = [
      makeEntry("1", "ventures"),
      makeEntry("2", "express"),
      makeEntry("3", "ventures"),
      makeEntry("4", "express"),
      makeEntry("5", "ventures"),
      makeEntry("6", "ventures"),
      makeEntry("7", "ventures"),
      makeEntry("8", "ventures"),
      makeEntry("9", "ventures"),
    ];
    const next = keepNewestPerSquad(mixed, "ventures", 6);
    expect(next.filter((item) => item.squadId === "express")).toHaveLength(2);
    expect(next.filter((item) => item.squadId === "ventures")).toHaveLength(6);
  });
});

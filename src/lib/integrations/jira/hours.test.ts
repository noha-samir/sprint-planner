import { describe, expect, it } from "vitest";
import {
  formatJiraTimeEstimate,
  hoursFromJiraNumberField,
  hoursFromJiraTimetracking,
  parseJiraTimeEstimate,
  splitHoursAcrossAssignees,
} from "./hours";

describe("splitHoursAcrossAssignees", () => {
  it("splits hours evenly across assignees", () => {
    expect(splitHoursAcrossAssignees(10, 2)).toEqual([5, 5]);
  });

  it("returns empty array when no assignees", () => {
    expect(splitHoursAcrossAssignees(8, 0)).toEqual([]);
  });
});

describe("formatJiraTimeEstimate", () => {
  it("formats whole hours", () => {
    expect(formatJiraTimeEstimate(8)).toBe("8h");
  });

  it("formats fractional hours", () => {
    expect(formatJiraTimeEstimate(1.5)).toBe("1h 30m");
  });
});

describe("parseJiraTimeEstimate", () => {
  it("parses hours and minutes", () => {
    expect(parseJiraTimeEstimate("8h")).toBe(8);
    expect(parseJiraTimeEstimate("1h 30m")).toBe(1.5);
    expect(parseJiraTimeEstimate("45m")).toBe(0.75);
  });
});

describe("hoursFromJiraTimetracking", () => {
  it("prefers seconds when present", () => {
    expect(hoursFromJiraTimetracking({ originalEstimateSeconds: 7200, originalEstimate: "1h" })).toBe(2);
  });
});

describe("hoursFromJiraNumberField", () => {
  it("reads numeric custom fields", () => {
    expect(hoursFromJiraNumberField(5)).toBe(5);
    expect(hoursFromJiraNumberField("3.5")).toBe(3.5);
    expect(hoursFromJiraNumberField(null)).toBeNull();
  });
});

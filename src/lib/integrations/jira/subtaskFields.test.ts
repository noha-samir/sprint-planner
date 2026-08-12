import { describe, expect, it } from "vitest";
import { buildSubtaskHourFields } from "./subtaskFields";

describe("buildSubtaskHourFields", () => {
  it("sets timetracking and development estimate custom field", () => {
    expect(buildSubtaskHourFields(8, "customfield_10001")).toEqual({
      timetracking: {
        originalEstimate: "8h",
        remainingEstimate: "8h",
      },
      customfield_10001: 8,
    });
  });

  it("returns empty estimate fields for zero hours as 0m", () => {
    expect(buildSubtaskHourFields(0, "customfield_10001")).toEqual({
      timetracking: {
        originalEstimate: "0m",
        remainingEstimate: "0m",
      },
      customfield_10001: 0,
    });
  });
});

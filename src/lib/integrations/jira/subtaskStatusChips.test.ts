import { describe, expect, it } from "vitest";
import { buildSubtaskStatusChips } from "./subtaskStatusChips";

const withSubtasks = (subtasks: NonNullable<Parameters<typeof buildSubtaskStatusChips>[0]["jira"]>["subtasks"]) => ({
  jira: { parentIssueKey: "BR-1", lastPushedAt: null, subtasks },
});

describe("buildSubtaskStatusChips", () => {
  it("returns nothing when the story has no linked subtasks", () => {
    expect(buildSubtaskStatusChips({})).toEqual([]);
    expect(buildSubtaskStatusChips(withSubtasks([]))).toEqual([]);
  });

  it("orders BE, FE, Android, iOS and labels each chip with its status", () => {
    const chips = buildSubtaskStatusChips(
      withSubtasks([
        { key: "BR-4", role: "ios", assigneeName: "Mona", hours: 3, status: "To Do" },
        { key: "BR-2", role: "fe", assigneeName: "Ali", hours: 5, status: "In Progress" },
        { key: "BR-3", role: "android", assigneeName: "", hours: 2, status: "Done" },
        { key: "BR-1", role: "be", assigneeName: "Sara", hours: 8, status: "Ready for Testing" },
      ]),
    );

    expect(chips.map((chip) => chip.label)).toEqual([
      "BE · Ready for Testing",
      "FE · In Progress",
      "AND · Done",
      "iOS · To Do",
    ]);
    expect(chips[0].title).toBe("BR-1 · BE · Sara · Ready for Testing");
    expect(chips[2].title).toBe("BR-3 · AND · Done");
  });

  it("marks unknown statuses and tells the user to pull", () => {
    const [chip] = buildSubtaskStatusChips(
      withSubtasks([{ key: "BR-9", role: "be", assigneeName: "Sara", hours: 1 }]),
    );

    expect(chip.status).toBeNull();
    expect(chip.label).toBe("BE · ?");
    expect(chip.title).toBe("BR-9 · BE · Sara · Status unknown — pull from Jira to refresh");
  });
});

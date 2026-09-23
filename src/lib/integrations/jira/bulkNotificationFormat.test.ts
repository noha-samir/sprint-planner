import { describe, expect, it } from "vitest";
import {
  emphasizeMessage,
  formatGroupedStoryMessages,
  isActionFailureMessage,
  partitionMessages,
  summaryToPlainText,
} from "./bulkNotificationFormat";
import { formatBulkPullSummary, bulkPullHasActionErrors } from "./bulkPullMessages";
import { formatBulkSyncSummary, bulkSyncHasActionErrors } from "./bulkSyncMessages";

describe("isActionFailureMessage", () => {
  it("flags updates that did not apply", () => {
    expect(
      isActionFailureMessage(
        'Product Manager "Hala" from Jira is not on the Resources roster (or assignee map) — PM assignee was not updated',
      ),
    ).toBe(true);
    expect(
      isActionFailureMessage(
        'FE subtask KEY: Jira assignee "X" is not on the Resources roster (or assignee map)',
      ),
    ).toBe(true);
    expect(isActionFailureMessage("Status sync failed for BR-1: timeout")).toBe(true);
    expect(isActionFailureMessage("Parent Dev 8h — no role subtasks")).toBe(true);
  });

  it("keeps informational notes as non-failures", () => {
    expect(
      isActionFailureMessage(
        'Jira status is "Discoped" — planner status was updated; Discoped still blocks future sync.',
      ),
    ).toBe(false);
    expect(isActionFailureMessage("Subtask KEY is missing or inaccessible — created a new one.")).toBe(
      false,
    );
    expect(isActionFailureMessage("FE subtask KEY has no assignee in Jira")).toBe(false);
    expect(isActionFailureMessage("No FE subtask")).toBe(false);
  });
});

describe("emphasizeMessage", () => {
  it("bolds hours and roles", () => {
    const segments = emphasizeMessage("Parent Dev 8h — no role subtasks");
    expect(segments.some((segment) => segment.text === "8h" && segment.emphasis)).toBe(true);
    expect(segments.some((segment) => segment.text === "Dev" && segment.emphasis)).toBe(true);
    expect(segments.some((segment) => /no role subtasks/i.test(segment.text) && segment.emphasis)).toBe(
      true,
    );
  });
});

describe("formatGroupedStoryMessages", () => {
  it("groups the same message across stories", () => {
    const text = formatGroupedStoryMessages([
      { story: "A", message: "PM assignee was not updated" },
      { story: "B", message: "PM assignee was not updated" },
      { story: "C", message: "Other issue" },
    ]);
    expect(text).toContain("• PM assignee was not updated");
    expect(text).toContain("— A");
    expect(text).toContain("— B");
    expect(text).toContain("• Other issue");
    expect(text).toContain("— C");
  });
});

describe("formatBulkPullSummary", () => {
  it("puts action failures under Errors and groups them", () => {
    const summary = formatBulkPullSummary({
      synced: 2,
      failed: 0,
      skipped: 0,
      results: [
        {
          taskId: "1",
          storyName: "Story A",
          ok: true,
          warnings: [
            'Product Manager "Hala" from Jira is not on the Resources roster — PM assignee was not updated',
          ],
        },
        {
          taskId: "2",
          storyName: "Story B",
          ok: true,
          warnings: [
            'Product Manager "Hala" from Jira is not on the Resources roster — PM assignee was not updated',
          ],
        },
      ],
    });
    expect(summary).toContain("Errors:");
    expect(summary).not.toContain("Warnings:");
    expect(summary).toContain("— Story A");
    expect(summary).toContain("— Story B");
    expect(bulkPullHasActionErrors({
      synced: 2,
      failed: 0,
      skipped: 0,
      results: [
        {
          taskId: "1",
          storyName: "Story A",
          ok: true,
          warnings: [
            'Product Manager "Hala" from Jira is not on the Resources roster — PM assignee was not updated',
          ],
        },
      ],
    })).toBe(true);
  });
});

describe("formatBulkSyncSummary", () => {
  it("treats row.errors as Errors not Warnings", () => {
    const summary = formatBulkSyncSummary({
      synced: 1,
      failed: 0,
      skipped: 0,
      results: [
        {
          taskId: "1",
          storyName: "Story A",
          ok: true,
          errors: ['FE has 4h on "Story A" but no assignee'],
        },
      ],
    });
    expect(summary).toContain("Errors:");
    expect(summary).not.toMatch(/Warnings/);
    expect(
      bulkSyncHasActionErrors({
        synced: 1,
        failed: 0,
        skipped: 0,
        results: [
          {
            taskId: "1",
            storyName: "Story A",
            ok: true,
            errors: ['FE has 4h on "Story A" but no assignee'],
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("partitionMessages", () => {
  it("splits action failures from soft warnings", () => {
    const { actionFailures, softWarnings } = partitionMessages([
      { story: "A", message: "PM assignee was not updated" },
      { story: "A", message: "FE subtask KEY has no assignee in Jira" },
    ]);
    expect(actionFailures).toHaveLength(1);
    expect(softWarnings).toHaveLength(1);
  });
});

describe("summaryToPlainText", () => {
  it("renders grouped sections", () => {
    const text = summaryToPlainText({
      headline: "2 stories pulled from Jira.",
      groups: [
        {
          severity: "error",
          segments: [{ text: "Parent Dev " }, { text: "8h", emphasis: true }, { text: " — no role subtasks" }],
          stories: ["A", "B"],
        },
      ],
    });
    expect(text).toContain("Errors:");
    expect(text).toContain("Parent Dev 8h — no role subtasks");
    expect(text).toContain("— A");
    expect(text).toContain("— B");
  });
});

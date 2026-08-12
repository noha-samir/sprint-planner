import { describe, expect, it } from "vitest";
import { buildStoryTimelineEntries, mergeAdjacentTimelineEntries } from "./storyTimelineEntries";
import type { ScheduledTask } from "./types";

const scheduledTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: "task-1",
  storyName: "Story",
  storyLink: "",
  poPriority: 1,
  status: "TODO",
  feBlocks: [],
  beBlocks: [],
          androidBlocks: [],
          iosBlocks: [],
          androidStart: null,
          androidEnd: null,
          iosStart: null,
          iosEnd: null,
  feStart: null,
  feEnd: null,
  beStart: null,
  beEnd: null,
  devEnd: null,
  integrationStart: null,
  integrationEnd: null,
  qcBlocks: [],
  qcStart: null,
  qcEnd: null,
  bufferStart: null,
  bufferEnd: null,
  uatReleaseDate: null,
  productionReleaseDate: null,
  releaseDate: null,
  isThursdayRelease: false,
  thursdayReleaseScope: "none",
  isOverflow: false,
  releaseGroup: null,
  ...overrides,
});

describe("buildStoryTimelineEntries", () => {
  it("orders phases chronologically", () => {
    const entries = buildStoryTimelineEntries(
      scheduledTask({
        beBlocks: [
          {
            resourceName: "Abbas",
            start: new Date("2026-06-02T09:00:00.000Z"),
            end: new Date("2026-06-02T17:00:00.000Z"),
            hours: 8,
          },
        ],
          androidBlocks: [],
          iosBlocks: [],
          androidStart: null,
          androidEnd: null,
          iosStart: null,
          iosEnd: null,
        feBlocks: [
          {
            resourceName: "Karim",
            start: new Date("2026-06-01T09:00:00.000Z"),
            end: new Date("2026-06-01T17:00:00.000Z"),
            hours: 8,
          },
        ],
      }),
    );

    expect(entries.map((entry) => entry.phase)).toEqual(["FE", "BE"]);
  });

  it("merges consecutive QC slices for the same tester", () => {
    const merged = mergeAdjacentTimelineEntries(
      buildStoryTimelineEntries(
        scheduledTask({
          qcBlocks: [
            {
              resourceName: "Alice",
              start: new Date("2026-06-03T08:00:00.000Z"),
              end: new Date("2026-06-03T16:00:00.000Z"),
              hours: 8,
            },
            {
              resourceName: "Alice",
              start: new Date("2026-06-04T08:00:00.000Z"),
              end: new Date("2026-06-04T14:00:00.000Z"),
              hours: 6,
            },
          ],
        }),
      ),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].phase).toBe("QC");
    expect(merged[0].resourceName).toBe("Alice");
    expect(merged[0].hours).toBe(14);
    expect(merged[0].start?.toISOString()).toBe("2026-06-03T08:00:00.000Z");
    expect(merged[0].end?.toISOString()).toBe("2026-06-04T14:00:00.000Z");
  });

  it("does not merge QC blocks for different testers", () => {
    const merged = mergeAdjacentTimelineEntries(
      buildStoryTimelineEntries(
        scheduledTask({
          qcBlocks: [
            {
              resourceName: "Alice",
              start: new Date("2026-06-03T08:00:00.000Z"),
              end: new Date("2026-06-03T16:00:00.000Z"),
              hours: 8,
            },
            {
              resourceName: "Hala",
              start: new Date("2026-06-03T08:00:00.000Z"),
              end: new Date("2026-06-03T16:00:00.000Z"),
              hours: 8,
            },
          ],
        }),
      ),
    );

    expect(merged.filter((entry) => entry.phase === "QC")).toHaveLength(2);
  });
});

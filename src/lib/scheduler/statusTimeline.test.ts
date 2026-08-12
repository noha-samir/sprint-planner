import { describe, expect, it } from "vitest";
import { getCurrentStoryPhase, getStatusHighlightPhase } from "./currentPhase";
import { effectiveReplanFromStep, statusImpliedReplanStep } from "./statusReplan";
import { buildStoryPhaseFlowEntries } from "./storyTimelineEntries";
import type { ScheduledTask } from "./types";

describe("statusImpliedReplanStep", () => {
  it("maps testing statuses to QC and UAT/ready-prod to Buffer", () => {
    expect(statusImpliedReplanStep("Ready for Testing")).toBe("QC");
    expect(statusImpliedReplanStep("Testing")).toBe("QC");
    expect(statusImpliedReplanStep("UAT")).toBe("Buffer");
    expect(statusImpliedReplanStep("Ready for Production")).toBe("Buffer");
    expect(statusImpliedReplanStep("In Progress")).toBeNull();
  });
});

describe("effectiveReplanFromStep", () => {
  it("uses the later of status and manual replan", () => {
    expect(effectiveReplanFromStep({ status: "Ready for Testing", replanFromStep: null })).toBe("QC");
    expect(effectiveReplanFromStep({ status: "Ready for Testing", replanFromStep: "Buffer" })).toBe("Buffer");
    expect(effectiveReplanFromStep({ status: "In Progress", replanFromStep: "FE" })).toBe("FE");
  });
});

describe("getStatusHighlightPhase", () => {
  it("borders QC for testing and Buffer for UAT / ready for production", () => {
    expect(getStatusHighlightPhase("Ready for Testing")).toBe("QC");
    expect(getStatusHighlightPhase("UAT")).toBe("Buffer");
    expect(getStatusHighlightPhase("Ready for Production")).toBe("Buffer");
  });
});

describe("getCurrentStoryPhase", () => {
  it("prefers status over time ranges for testing and UAT", () => {
    const task = {
      status: "Ready for Testing",
      beStart: new Date("2026-06-01T09:00:00.000Z"),
      beEnd: new Date("2026-06-01T17:00:00.000Z"),
      feStart: null,
      feEnd: null,
      androidStart: null,
      androidEnd: null,
      iosStart: null,
      iosEnd: null,
      integrationStart: null,
      integrationEnd: null,
      qcStart: new Date("2026-06-03T09:00:00.000Z"),
      qcEnd: new Date("2026-06-03T17:00:00.000Z"),
      bufferStart: null,
      bufferEnd: null,
    };
    expect(getCurrentStoryPhase(task, new Date("2026-06-01T12:00:00.000Z"))).toBe("QC");
  });

  it("borders FE when replan starts from FE and work has not begun", () => {
    const task = {
      status: "In Progress",
      replanFromStep: "FE" as const,
      beStart: null,
      beEnd: null,
      feStart: new Date("2026-06-05T09:00:00.000Z"),
      feEnd: new Date("2026-06-05T17:00:00.000Z"),
      androidStart: null,
      androidEnd: null,
      iosStart: null,
      iosEnd: null,
      integrationStart: null,
      integrationEnd: null,
      qcStart: null,
      qcEnd: null,
      bufferStart: null,
      bufferEnd: null,
    };
    expect(getCurrentStoryPhase(task, new Date("2026-06-01T12:00:00.000Z"))).toBe("FE");
  });
});

describe("buildStoryPhaseFlowEntries", () => {
  it("keeps earlier planned phases when status is Ready for Testing", () => {
    const scheduled: ScheduledTask = {
      id: "task-1",
      storyName: "Story",
      storyLink: "",
      poPriority: 1,
      status: "Ready for Testing",
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
      qcBlocks: [
        {
          resourceName: "Alice",
          start: new Date("2026-06-03T08:00:00.000Z"),
          end: new Date("2026-06-03T16:00:00.000Z"),
          hours: 8,
        },
      ],
      qcStart: new Date("2026-06-03T08:00:00.000Z"),
      qcEnd: new Date("2026-06-03T16:00:00.000Z"),
      bufferStart: new Date("2026-06-04T08:00:00.000Z"),
      bufferEnd: new Date("2026-06-04T09:00:00.000Z"),
      uatReleaseDate: null,
      productionReleaseDate: null,
      releaseDate: null,
      isThursdayRelease: false,
      thursdayReleaseScope: "none",
      isOverflow: false,
      releaseGroup: null,
    };

    const entries = buildStoryPhaseFlowEntries(
      scheduled,
      {
        beHours: 6,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        feHours: 8,
        integrationHours: 2,
        qcHours: 4,
        bufferHours: 1,
        beDevs: ["Abbas"],
        feDevs: ["Karim"],
        qcs: ["Alice"],
      },
      "QC",
    );

    expect(entries.map((entry) => entry.phase)).toEqual(["BE", "FE", "Integration", "QC", "Buffer"]);
    expect(entries.filter((entry) => entry.completed).map((entry) => entry.phase)).toEqual([
      "BE",
      "FE",
      "Integration",
    ]);
  });

  it("keeps later planned phases visible when the schedule starts at QC", () => {
    const scheduled: ScheduledTask = {
      id: "task-2",
      storyName: "Story",
      storyLink: "",
      poPriority: 1,
      status: "Ready for Testing",
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
      qcBlocks: [
        {
          resourceName: "Alice",
          start: new Date("2026-06-03T08:00:00.000Z"),
          end: new Date("2026-06-03T16:00:00.000Z"),
          hours: 8,
        },
      ],
      qcStart: new Date("2026-06-03T08:00:00.000Z"),
      qcEnd: new Date("2026-06-03T16:00:00.000Z"),
      bufferStart: null,
      bufferEnd: null,
      uatReleaseDate: null,
      productionReleaseDate: null,
      releaseDate: null,
      isThursdayRelease: false,
      thursdayReleaseScope: "none",
      isOverflow: false,
      releaseGroup: null,
    };

    const entries = buildStoryPhaseFlowEntries(
      scheduled,
      {
        beHours: 6,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        feHours: 8,
        integrationHours: 2,
        qcHours: 8,
        bufferHours: 2,
        beDevs: ["Abbas"],
        feDevs: ["Karim"],
        qcs: ["Alice"],
      },
      "QC",
    );

    expect(entries.map((entry) => entry.phase)).toEqual(["BE", "FE", "Integration", "QC", "Buffer"]);
    expect(entries.find((entry) => entry.phase === "Buffer")?.completed).toBe(false);
  });

  it("collapses preempted BE slices into one box using plan hours", () => {
    const scheduled: ScheduledTask = {
      id: "pudo",
      storyName: "Counter Hub – PUDO by Bosta",
      storyLink: "",
      poPriority: 4,
      status: "Ready for Review",
      feBlocks: [
        {
          resourceName: "Karim",
          start: new Date("2026-06-02T08:00:00.000Z"),
          end: new Date("2026-06-02T16:00:00.000Z"),
          hours: 8,
        },
      ],
      beBlocks: [
        {
          resourceName: "Abbas",
          start: new Date("2026-06-01T08:00:00.000Z"),
          end: new Date("2026-06-01T16:00:00.000Z"),
          hours: 8,
        },
        {
          resourceName: "Abbas",
          start: new Date("2026-06-03T08:00:00.000Z"),
          end: new Date("2026-06-04T16:00:00.000Z"),
          hours: 16,
        },
      ],
          androidBlocks: [],
          iosBlocks: [],
          androidStart: null,
          androidEnd: null,
          iosStart: null,
          iosEnd: null,
      feStart: new Date("2026-06-02T08:00:00.000Z"),
      feEnd: new Date("2026-06-02T16:00:00.000Z"),
      beStart: new Date("2026-06-01T08:00:00.000Z"),
      beEnd: new Date("2026-06-04T16:00:00.000Z"),
      devEnd: new Date("2026-06-04T16:00:00.000Z"),
      integrationStart: null,
      integrationEnd: null,
      qcBlocks: [
        {
          resourceName: "Alice",
          start: new Date("2026-06-05T08:00:00.000Z"),
          end: new Date("2026-06-05T14:00:00.000Z"),
          hours: 6,
        },
      ],
      qcStart: new Date("2026-06-05T08:00:00.000Z"),
      qcEnd: new Date("2026-06-05T14:00:00.000Z"),
      bufferStart: null,
      bufferEnd: null,
      uatReleaseDate: null,
      productionReleaseDate: null,
      releaseDate: null,
      isThursdayRelease: false,
      thursdayReleaseScope: "none",
      isOverflow: false,
      releaseGroup: null,
    };

    const entries = buildStoryPhaseFlowEntries(
      scheduled,
      {
        beHours: 8,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        feHours: 8,
        integrationHours: 0,
        qcHours: 6,
        bufferHours: 0,
        beDevs: ["Abbas"],
        feDevs: ["Karim"],
        qcs: ["Alice"],
      },
      "BE",
    );

    expect(entries.map((entry) => entry.phase)).toEqual(["BE", "FE", "QC"]);
    expect(entries.find((entry) => entry.phase === "BE")?.hours).toBe(8);
  });

  it("keeps planned BE when the schedule starts from FE", () => {
    const scheduled: ScheduledTask = {
      id: "task-fe-start",
      storyName: "Story",
      storyLink: "",
      poPriority: 1,
      status: "In Progress",
      feBlocks: [
        {
          resourceName: "Karim",
          start: new Date("2026-06-05T08:00:00.000Z"),
          end: new Date("2026-06-05T16:00:00.000Z"),
          hours: 8,
        },
      ],
      beBlocks: [],
          androidBlocks: [],
          iosBlocks: [],
          androidStart: null,
          androidEnd: null,
          iosStart: null,
          iosEnd: null,
      feStart: new Date("2026-06-05T08:00:00.000Z"),
      feEnd: new Date("2026-06-05T16:00:00.000Z"),
      beStart: null,
      beEnd: null,
      devEnd: new Date("2026-06-05T16:00:00.000Z"),
      integrationStart: null,
      integrationEnd: null,
      qcBlocks: [
        {
          resourceName: "Alice",
          start: new Date("2026-06-06T08:00:00.000Z"),
          end: new Date("2026-06-06T14:00:00.000Z"),
          hours: 6,
        },
      ],
      qcStart: new Date("2026-06-06T08:00:00.000Z"),
      qcEnd: new Date("2026-06-06T14:00:00.000Z"),
      bufferStart: null,
      bufferEnd: null,
      uatReleaseDate: null,
      productionReleaseDate: null,
      releaseDate: null,
      isThursdayRelease: false,
      thursdayReleaseScope: "none",
      isOverflow: false,
      releaseGroup: null,
    };

    const entries = buildStoryPhaseFlowEntries(
      scheduled,
      {
        beHours: 8,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        feHours: 8,
        integrationHours: 0,
        qcHours: 6,
        bufferHours: 0,
        beDevs: ["Abbas"],
        feDevs: ["Karim"],
        qcs: ["Alice"],
      },
      "FE",
    );

    expect(entries.map((entry) => entry.phase)).toEqual(["BE", "FE", "QC"]);
    expect(entries.find((entry) => entry.phase === "BE")?.completed).toBe(true);
    expect(entries.find((entry) => entry.phase === "BE")?.hours).toBe(8);
    expect(entries.find((entry) => entry.phase === "FE")?.completed).toBeFalsy();
  });
});

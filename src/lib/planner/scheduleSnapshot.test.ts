import { describe, expect, it } from "vitest";
import { defaultPlannerMeta } from "./plannerMeta";
import { getTasksNeedingRemark, markTaskIdsNeedRemark, clearTasksNeedRemark, patchShouldMarkTaskNeedRemark, patchOnlyIgnoresRemark, applyPlannerMetaForTaskPatch } from "./pendingMarkProgress";
import {
  deserializeScheduleResult,
  mergeFrozenScheduleWithFresh,
  serializeScheduleResult,
} from "./scheduleSnapshot";
import type { ScheduleResult, Task } from "@/lib/scheduler/types";

const sampleResult = (): ScheduleResult => ({
  sprintEndDate: new Date("2026-05-14T17:00:00.000Z"),
  tasks: [
    {
      id: "task-a",
      storyName: "Story A",
      storyLink: "",
      poPriority: 1,
      status: "UAT",
      feBlocks: [],
      beBlocks: [],
      androidBlocks: [
        {
          resourceName: "MO-1",
          start: new Date("2026-05-08T09:00:00.000Z"),
          end: new Date("2026-05-08T17:00:00.000Z"),
          hours: 8,
        },
      ],
      iosBlocks: [],
      feStart: null,
      feEnd: null,
      beStart: null,
      beEnd: null,
      androidStart: new Date("2026-05-08T09:00:00.000Z"),
      androidEnd: new Date("2026-05-08T17:00:00.000Z"),
      iosStart: null,
      iosEnd: null,
      devEnd: null,
      integrationStart: null,
      integrationEnd: null,
      qcBlocks: [],
      qcStart: null,
      qcEnd: null,
      bufferStart: new Date("2026-05-10T11:00:00.000Z"),
      bufferEnd: new Date("2026-05-10T13:00:00.000Z"),
      uatReleaseDate: new Date("2026-05-10T13:00:00.000Z"),
      productionReleaseDate: new Date("2026-05-11T10:00:00.000Z"),
      releaseDate: new Date("2026-05-10T13:00:00.000Z"),
      isThursdayRelease: false,
      thursdayReleaseScope: "none",
      isOverflow: false,
      releaseGroup: "Group A",
    },
  ],
});

describe("scheduleSnapshot", () => {
  it("round-trips schedule results through serialization", () => {
    const original = sampleResult();
    const restored = deserializeScheduleResult(serializeScheduleResult(original));
    expect(restored.tasks[0].releaseDate?.toISOString()).toBe(original.tasks[0].releaseDate?.toISOString());
    expect(restored.sprintEndDate.toISOString()).toBe(original.sprintEndDate.toISOString());
    expect(restored.tasks[0].androidBlocks).toHaveLength(1);
    expect(restored.tasks[0].androidBlocks[0].resourceName).toBe("MO-1");
    expect(restored.tasks[0].androidBlocks[0].hours).toBe(8);
    expect(restored.tasks[0].androidStart?.toISOString()).toBe(original.tasks[0].androidStart?.toISOString());
    expect(restored.tasks[0].androidEnd?.toISOString()).toBe(original.tasks[0].androidEnd?.toISOString());
  });

  it("keeps frozen release dates when fresh schedule changes after QC/buffer edits", () => {
    const frozen = sampleResult();
    frozen.tasks[0].status = "Testing";
    const fresh = sampleResult();
    fresh.tasks[0].status = "Testing";
    fresh.tasks[0].releaseDate = new Date("2026-05-20T16:00:00.000Z");
    fresh.tasks[0].uatReleaseDate = new Date("2026-05-20T16:00:00.000Z");

    const merged = mergeFrozenScheduleWithFresh(frozen, fresh, new Set(["task-a"]));
    expect(merged.tasks[0].releaseDate?.toISOString()).toBe("2026-05-10T13:00:00.000Z");
    expect(merged.tasks[0].status).toBe("Testing");
  });

  it("clears frozen release dates when status is UAT or later pending on PM", () => {
    const frozen = sampleResult();
    const fresh = sampleResult();
    fresh.tasks[0].status = "Ready for Production";

    const merged = mergeFrozenScheduleWithFresh(frozen, fresh, new Set(["task-a"]));
    expect(merged.tasks[0].releaseDate).toBeNull();
    expect(merged.tasks[0].uatReleaseDate).toBeNull();
    expect(merged.tasks[0].productionReleaseDate).toBeNull();
    expect(merged.tasks[0].status).toBe("Ready for Production");
  });

  it("flags task ids marked since last Mark Progress Now", () => {
    const meta = markTaskIdsNeedRemark(
      {
        ...defaultPlannerMeta(),
        uatTrackingEnabled: true,
        curScheduleTakenAt: "2026-05-01T10:00:00.000Z",
      },
      ["task-a"],
    );
    const pending = getTasksNeedingRemark(meta, ["task-a", "task-b"]);
    expect(pending.has("task-a")).toBe(true);
    expect(pending.has("task-b")).toBe(false);
  });

  it("clears need-remark flags on Mark Progress Now", () => {
    const meta = clearTasksNeedRemark(
      markTaskIdsNeedRemark(
        {
          ...defaultPlannerMeta(),
          uatTrackingEnabled: true,
          curScheduleTakenAt: "2026-05-01T10:00:00.000Z",
        },
        ["task-a"],
      ),
    );
    expect(getTasksNeedingRemark(meta, ["task-a"]).size).toBe(0);
  });
});

describe("patchShouldMarkTaskNeedRemark", () => {
  it("returns false for cosmetic-only patches (link, tags, notes, name, jira)", () => {
    expect(patchShouldMarkTaskNeedRemark({ storyLink: "https://jira.example/browse/ABC-1" })).toBe(false);
    expect(patchShouldMarkTaskNeedRemark({ tags: ["urgent"] })).toBe(false);
    expect(patchShouldMarkTaskNeedRemark({ taskNotes: "- [ ] todo" })).toBe(false);
    expect(patchShouldMarkTaskNeedRemark({ storyName: "Renamed" })).toBe(false);
    expect(
      patchShouldMarkTaskNeedRemark({
        jira: {
          parentIssueKey: "ABC-1",
          lastPushedAt: "2026-06-01T00:00:00.000Z",
          subtasks: [],
        },
      }),
    ).toBe(false);
  });

  it("returns true when cosmetic fields are combined with schedule fields", () => {
    expect(
      patchShouldMarkTaskNeedRemark({ storyLink: "https://jira.example/browse/ABC-1", status: "UAT" }),
    ).toBe(true);
  });

  it("returns true for schedule-affecting patches", () => {
    expect(patchShouldMarkTaskNeedRemark({ feHours: 4 })).toBe(true);
    expect(patchShouldMarkTaskNeedRemark({ androidHours: 6 })).toBe(true);
    expect(patchShouldMarkTaskNeedRemark({ androidDevs: ["MO-1"] })).toBe(true);
    expect(patchShouldMarkTaskNeedRemark({ moStartDate: "2026-08-12" })).toBe(true);
    expect(patchShouldMarkTaskNeedRemark({ status: "In Progress" })).toBe(true);
  });

  it("applyPlannerMetaForTaskPatch leaves remark unchanged on cosmetic edits", () => {
    const meta = markTaskIdsNeedRemark(
      { ...defaultPlannerMeta(), uatTrackingEnabled: true, curScheduleTakenAt: "2026-05-01T10:00:00.000Z" },
      ["task-a"],
    );
    const next = applyPlannerMetaForTaskPatch(meta, "task-a", {
      storyLink: "https://jira.example/browse/ABC-1",
      tags: ["x"],
      storyName: "Renamed",
    });
    expect(getTasksNeedingRemark(next, ["task-a"]).size).toBe(1);
  });

  it("applyPlannerMetaForTaskPatch still marks when link is edited with hours", () => {
    const meta = {
      ...defaultPlannerMeta(),
      uatTrackingEnabled: true,
      curScheduleTakenAt: "2026-05-01T10:00:00.000Z",
    };
    const next = applyPlannerMetaForTaskPatch(meta, "task-a", {
      storyLink: "https://jira.example/browse/ABC-1",
      feHours: 4,
    });
    expect(patchOnlyIgnoresRemark({ storyLink: "https://jira.example/browse/ABC-1" })).toBe(true);
    expect(getTasksNeedingRemark(next, ["task-a"]).size).toBe(1);
  });

  it("marks remark when a Jira pull patch changes hours or assignees", () => {
    const meta = {
      ...defaultPlannerMeta(),
      uatTrackingEnabled: true,
      curScheduleTakenAt: "2026-05-01T10:00:00.000Z",
    };
    const task = {
      id: "task-a",
      storyName: "Pricing",
      storyLink: "https://jira.example/browse/ABC-1",
      poPriority: null,
      feDevs: ["Karim"],
      feHours: 4,
      beDevs: ["Abbas"],
      beHours: 3,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
      integrationHours: 0,
      qcs: ["Hala"],
      qcHours: 2,
      bufferHours: 0,
      status: "In Progress",
    } as Task;

    const hoursChanged = applyPlannerMetaForTaskPatch(
      meta,
      "task-a",
      {
        feHours: 6,
        beHours: 3,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["Karim"],
        beDevs: ["Abbas"],
        qcs: ["Hala"],
        qcHours: 2,
        status: "In Progress",
        jira: {
          parentIssueKey: "ABC-1",
          lastPushedAt: null,
          lastPulledAt: "2026-05-02T10:00:00.000Z",
          subtasks: [],
        },
      },
      { ...task },
    );
    expect(getTasksNeedingRemark(hoursChanged, ["task-a"]).size).toBe(1);

    const assigneeChanged = applyPlannerMetaForTaskPatch(
      meta,
      "task-a",
      {
        feHours: 4,
        beHours: 3,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["Alice"],
        beDevs: ["Abbas"],
        jira: {
          parentIssueKey: "ABC-1",
          lastPushedAt: null,
          lastPulledAt: "2026-05-02T10:00:00.000Z",
          subtasks: [],
        },
      },
      { ...task },
    );
    expect(getTasksNeedingRemark(assigneeChanged, ["task-a"]).size).toBe(1);

    const statusChanged = applyPlannerMetaForTaskPatch(
      meta,
      "task-a",
      {
        feHours: 4,
        beHours: 3,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["Karim"],
        beDevs: ["Abbas"],
        status: "Testing",
        jira: {
          parentIssueKey: "ABC-1",
          lastPushedAt: null,
          lastPulledAt: "2026-05-02T10:00:00.000Z",
          subtasks: [],
        },
      },
      { ...task },
    );
    expect(getTasksNeedingRemark(statusChanged, ["task-a"]).size).toBe(1);
  });

  it("does not mark remark when a Jira pull only refreshes sync metadata", () => {
    const meta = {
      ...defaultPlannerMeta(),
      uatTrackingEnabled: true,
      curScheduleTakenAt: "2026-05-01T10:00:00.000Z",
    };
    const task = {
      id: "task-a",
      storyName: "Pricing",
      storyLink: "https://jira.example/browse/ABC-1",
      poPriority: null,
      feDevs: ["Karim"],
      feHours: 4,
      beDevs: ["Abbas"],
      beHours: 3,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
      integrationHours: 0,
      qcs: ["Hala"],
      qcHours: 2,
      bufferHours: 0,
      status: "In Progress",
      jira: {
        parentIssueKey: "ABC-1",
        lastPushedAt: null,
        lastPulledAt: "2026-05-01T09:00:00.000Z",
        subtasks: [],
      },
    } as Task;

    const metaOnly = applyPlannerMetaForTaskPatch(
      meta,
      "task-a",
      {
        feHours: 4,
        beHours: 3,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["Karim"],
        beDevs: ["Abbas"],
        qcs: ["Hala"],
        qcHours: 2,
        status: "In Progress",
        jira: {
          parentIssueKey: "ABC-1",
          lastPushedAt: null,
          lastPulledAt: "2026-05-02T10:00:00.000Z",
          subtasks: [],
        },
      },
      { ...task },
    );
    expect(getTasksNeedingRemark(metaOnly, ["task-a"]).size).toBe(0);
  });
});

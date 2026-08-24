import { describe, expect, it } from "vitest";
import { format } from "date-fns";
import {
  addWorkingDays,
  advanceByWorkingHours,
  getProductionReleaseDateFrom,
  getSprintWindowEnd,
  isNonWorkingDay,
  resolveUatReleaseDate,
} from "./calendar";
import { schedule } from "./engine";
import type { Config, Resource, Task } from "./types";

const config: Config = {
  sprintStartDate: "2026-04-26",
  planningSunday: "2026-04-26",
  extraHolidays: [],
  hoursPerDay: 8,
  sprintWorkingDays: 10,
  theme: "ocean",
  workdayStartHour: 9,
};

const dateKey = (value: Date) => format(value, "yyyy-MM-dd");

describe("calendar utilities", () => {
  it("ends sprint on the previous working day when the last sprint-slot day is an extra holiday", () => {
    const holidayLastSlot: Config = {
      sprintStartDate: "2026-05-03",
      planningSunday: "2026-05-03",
      extraHolidays: ["2026-05-14"],
      hoursPerDay: 8,
      sprintWorkingDays: 10,
      theme: "ocean",
      workdayStartHour: 9,
    };
    const end = getSprintWindowEnd(holidayLastSlot);
    expect(dateKey(end)).toBe("2026-05-13");
    expect(end.getHours()).toBe(17);
  });

  it("treats planning day as non-working even if it matches sprint start", () => {
    const sprintStart = new Date("2026-04-26T09:00:00");
    expect(isNonWorkingDay(sprintStart, config)).toBe(true);
  });

  it("treats biweekly planning Sundays as non-working (not every Sunday)", () => {
    const betweenPlanningSunday = new Date("2026-05-03T09:00:00");
    expect(isNonWorkingDay(betweenPlanningSunday, config)).toBe(false);
    const secondPlanningSunday = new Date("2026-05-10T09:00:00");
    expect(isNonWorkingDay(secondPlanningSunday, config)).toBe(true);
  });

  it("moves to next working day when sprint start is planning day", () => {
    const start = new Date("2026-04-26T09:00:00");
    const end = addWorkingDays(start, 1, config);
    expect(end.getDate()).toBe(27);
    expect(end.getHours()).toBe(17);
  });

  it("advances with fallback hours per day when config has zero", () => {
    const start = new Date("2026-04-27T09:00:00");
    const end = advanceByWorkingHours(start, 4, { ...config, hoursPerDay: 0 });
    expect(end.getHours()).toBe(13);
  });

  it("does not skip the next working day after using up a full day", () => {
    // Mon 17:30 with 8h days (11–19): 1.5h Mon + 8h Tue + 8h Wed + 0.5h Thu = 18h
    const lateStartConfig: Config = {
      sprintStartDate: "2026-07-12",
      planningSunday: "2026-07-12",
      extraHolidays: [],
      hoursPerDay: 8,
      sprintWorkingDays: 10,
      theme: "ocean",
      workdayStartHour: 11,
    };
    const start = new Date(2026, 6, 13, 17, 30, 0);
    const end = advanceByWorkingHours(start, 18, lateStartConfig);
    expect(dateKey(end)).toBe("2026-07-16");
    expect(end.getHours()).toBe(11);
    expect(end.getMinutes()).toBe(30);
  });

  it("moves UAT to next working day start when ready time is in the last work hour", () => {
    const uatConfig: Config = {
      sprintStartDate: "2026-07-12",
      planningSunday: "2026-07-12",
      extraHolidays: [],
      hoursPerDay: 8,
      sprintWorkingDays: 10,
      theme: "ocean",
      workdayStartHour: 11,
    };
    // Thu 18:30 is in the last hour (18–19); Fri/Sat off → next working start Sun 11:00
    const readyAt = new Date(2026, 6, 16, 18, 30, 0);
    const uat = resolveUatReleaseDate(readyAt, uatConfig);
    expect(dateKey(uat)).toBe("2026-07-19");
    expect(uat.getHours()).toBe(11);
    expect(uat.getMinutes()).toBe(0);
  });

  it("keeps UAT at ready time when it is before the last work hour", () => {
    const uatConfig: Config = {
      sprintStartDate: "2026-07-12",
      planningSunday: "2026-07-12",
      extraHolidays: [],
      hoursPerDay: 8,
      sprintWorkingDays: 10,
      theme: "ocean",
      workdayStartHour: 11,
    };
    const readyAt = new Date(2026, 6, 16, 17, 0, 0);
    const uat = resolveUatReleaseDate(readyAt, uatConfig);
    expect(dateKey(uat)).toBe("2026-07-16");
    expect(uat.getHours()).toBe(17);
  });
});

describe("scheduler behavior", () => {
  it("preempts active QC work when a higher-priority task becomes ready, then resumes", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE" },
      { name: "FE-1", type: "FE" },
      { name: "QC-1", type: "QC" },
    ];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tasks: Task[] = [
      {
        id: "long-qc",
        storyName: "Long QC Task",
        storyLink: "",
        poPriority: 5,
        feDevs: ["FE-1"],
        feHours: 0,
        beDevs: ["BE-1"],
        beHours: 0,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        integrationHours: 0,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 16,
        bufferHours: 0,
        status: "TODO",
      },
      {
        id: "urgent-small",
        storyName: "Urgent Small Task",
        storyLink: "",
        poPriority: 1,
        feDevs: ["FE-1"],
        feHours: 8,
        beDevs: ["BE-1"],
        beHours: 8,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        integrationHours: 0,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 1,
        bufferHours: 0,
        status: "TODO",
      },
    ];

    const result = schedule(tasks, resources, config);
    const longQc = result.tasks.find((task) => task.id === "long-qc");
    const urgent = result.tasks.find((task) => task.id === "urgent-small");

    expect(longQc).toBeDefined();
    expect(urgent).toBeDefined();
    expect(longQc!.qcBlocks.length).toBeGreaterThanOrEqual(2);
    expect(urgent!.qcBlocks.length).toBe(1);

    const firstLongBlock = longQc!.qcBlocks[0];
    const lastLongBlock = longQc!.qcBlocks[longQc!.qcBlocks.length - 1];
    const urgentBlock = urgent!.qcBlocks[0];

    expect(firstLongBlock.end.getTime()).toBeLessThanOrEqual(urgentBlock.start.getTime());
    expect(lastLongBlock.start.getTime()).toBeGreaterThanOrEqual(urgentBlock.end.getTime());
    expect(longQc!.qcBlocks.reduce((sum, block) => sum + block.hours, 0)).toBeCloseTo(16, 5);
  });

  it("keeps deterministic order for equal-priority preemptive slices", () => {
    const resources: Resource[] = [{ name: "QC-1", type: "QC" }];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tasks: Task[] = [
      {
        id: "task-a",
        storyName: "Task A",
        storyLink: "",
        poPriority: 2,
        feDevs: [],
        feHours: 0,
        beDevs: [],
        beHours: 0,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        integrationHours: 0,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 3,
        bufferHours: 0,
        status: "TODO",
      },
      {
        id: "task-b",
        storyName: "Task B",
        storyLink: "",
        poPriority: 2,
        feDevs: [],
        feHours: 0,
        beDevs: [],
        beHours: 0,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        integrationHours: 0,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 2,
        bufferHours: 0,
        status: "TODO",
      },
    ];

    const firstRun = schedule(tasks, resources, config);
    const secondRun = schedule(tasks, resources, config);

    const firstRunTaskA = firstRun.tasks.find((task) => task.id === "task-a");
    const firstRunTaskB = firstRun.tasks.find((task) => task.id === "task-b");
    const secondRunTaskA = secondRun.tasks.find((task) => task.id === "task-a");
    const secondRunTaskB = secondRun.tasks.find((task) => task.id === "task-b");

    expect(firstRunTaskA?.qcStart?.getTime()).toBe(secondRunTaskA?.qcStart?.getTime());
    expect(firstRunTaskA?.qcEnd?.getTime()).toBe(secondRunTaskA?.qcEnd?.getTime());
    expect(firstRunTaskB?.qcStart?.getTime()).toBe(secondRunTaskB?.qcStart?.getTime());
    expect(firstRunTaskB?.qcEnd?.getTime()).toBe(secondRunTaskB?.qcEnd?.getTime());
  });

  it("aligns release dates for stories in the same release group", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE" },
      { name: "FE-1", type: "FE" },
      { name: "QC-1", type: "QC" },
    ];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tasks: Task[] = [
      {
        id: "fast",
        storyName: "Fast story",
        storyLink: "",
        poPriority: 1,
        feDevs: ["FE-1"],
        feHours: 2,
        beDevs: ["BE-1"],
        beHours: 2,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        integrationHours: 0,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 1,
        bufferHours: 0,
        releaseGroup: "Bundle",
        status: "TODO",
      },
      {
        id: "slow",
        storyName: "Slow story",
        storyLink: "",
        poPriority: 2,
        feDevs: ["FE-1"],
        feHours: 8,
        beDevs: ["BE-1"],
        beHours: 8,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        integrationHours: 0,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 4,
        bufferHours: 0,
        releaseGroup: "Bundle",
        status: "TODO",
      },
    ];

    const result = schedule(tasks, resources, config);
    const fast = result.tasks.find((task) => task.id === "fast");
    const slow = result.tasks.find((task) => task.id === "slow");
    expect(fast?.releaseDate).not.toBeNull();
    expect(slow?.releaseDate).not.toBeNull();
    expect(fast!.releaseDate!.getTime()).toBe(slow!.releaseDate!.getTime());
    expect(fast!.productionReleaseDate!.getTime()).toBe(slow!.productionReleaseDate!.getTime());
  });

  it("schedules UAT release when replan starts from Buffer with remaining buffer hours only", () => {
    const replanConfig: Config = {
      ...config,
      replanAsOf: "2026-04-27T11:00:00.000Z",
    };
    const resources: Resource[] = [{ name: "QC-1", type: "QC" }];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tasks: Task[] = [
      {
        id: "uat-buffer-only",
        storyName: "UAT buffer story",
        storyLink: "",
        poPriority: null,
        feDevs: ["FE-1"],
        feHours: 8,
        beDevs: ["BE-1"],
        beHours: 8,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        integrationHours: 0,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 4,
        bufferHours: 2,
        replanFromStep: "Buffer",
        status: "UAT",
      },
    ];

    const result = schedule(tasks, resources, replanConfig);
    const task = result.tasks[0];

    expect(task.qcBlocks).toHaveLength(0);
    expect(task.bufferStart).not.toBeNull();
    expect(task.bufferEnd).not.toBeNull();
    expect(task.releaseDate).toBeNull();
    expect(task.uatReleaseDate).toBeNull();
    expect(task.productionReleaseDate).toBeNull();
    expect(task.bufferEnd!.getTime()).toBeGreaterThan(task.bufferStart!.getTime());
  });

  it("does not create integration window when integration hours are zero", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE" },
      { name: "FE-1", type: "FE" },
      { name: "QC-1", type: "QC" },
    ];
    const tasks: Task[] = [
      {
        id: "task-1",
        storyName: "Story One",
        storyLink: "https://example.com/story-1",
        poPriority: null,
        feDevs: ["FE-1"],
        feHours: 4,
        beDevs: ["BE-1"],
        beHours: 6,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        integrationHours: 0,
        integrationFlags: {
          needsDevOps: false,
          needsCdc: false,
          needsDbSync: false,
          needsOtherSquad: false,
          needsThirdParty: false,
        },
        qcs: ["QC-1"],
        qcHours: 2,
        bufferHours: 0,
        status: "TODO",
      },
    ];

    const result = schedule(tasks, resources, config);
    expect(result.tasks[0].integrationStart).toBeNull();
    expect(result.tasks[0].integrationEnd).toBeNull();
    expect(result.tasks[0].storyName).toBe("Story One");
  });

  it("rolls UAT when QC ends in the last work hour; production follows next business day", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE" },
      { name: "FE-1", type: "FE" },
      { name: "QC-1", type: "QC" },
    ];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };

    const onTimeTask: Task = {
      id: "on-time",
      storyName: "On time release",
      storyLink: "",
      poPriority: 1,
      feDevs: ["FE-1"],
      feHours: 6,
      beDevs: ["BE-1"],
      beHours: 6,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
      integrationHours: 0,
      integrationFlags: flags,
      qcs: ["QC-1"],
      qcHours: 1,
      bufferHours: 0,
      status: "TODO",
    };

    const lateTask: Task = {
      ...onTimeTask,
      id: "late",
      storyName: "Late release",
      qcHours: 2,
    };

    const onTimeResult = schedule([onTimeTask], resources, config).tasks[0];
    const lateResult = schedule([lateTask], resources, config).tasks[0];

    expect(onTimeResult.releaseDate).not.toBeNull();
    expect(onTimeResult.productionReleaseDate).not.toBeNull();
    expect(lateResult.releaseDate).not.toBeNull();
    expect(lateResult.productionReleaseDate).not.toBeNull();

    // Workday 09–17: QC ending at 16:00 or 17:00 is in the last hour → UAT next working day 09:00
    expect(onTimeResult.releaseDate!.getHours()).toBe(9);
    expect(lateResult.releaseDate!.getHours()).toBe(9);
    expect(onTimeResult.productionReleaseDate!.getTime()).toBeGreaterThan(onTimeResult.releaseDate!.getTime());
    expect(lateResult.productionReleaseDate!.getTime()).toBeGreaterThan(lateResult.releaseDate!.getTime());
  });

  it("pushes production to 10:00 when the next-business-day copy of UAT is after 16:00", () => {
    const prodConfig: Config = {
      sprintStartDate: "2026-07-12",
      planningSunday: "2026-07-12",
      extraHolidays: [],
      hoursPerDay: 8,
      sprintWorkingDays: 10,
      theme: "ocean",
      workdayStartHour: 11,
    };
    // UAT Thu 17:00 (before last hour 18–19) → next biz day Sun 17:00 → after cutoff → Mon 10:00
    const uat = new Date(2026, 6, 16, 17, 0, 0);
    const production = getProductionReleaseDateFrom(uat, prodConfig);
    expect(dateKey(production)).toBe("2026-07-20");
    expect(production.getHours()).toBe(10);
    expect(production.getMinutes()).toBe(0);
  });
  it("computes release dates correctly across multi-story workload, vacations, and shared resources", () => {
    const complexConfig: Config = {
      sprintStartDate: "2026-05-04",
      planningSunday: "2026-05-03",
      extraHolidays: ["2026-05-06", "2026-05-13"],
      hoursPerDay: 8,
      sprintWorkingDays: 15,
      theme: "ocean",
      workdayStartHour: 9,
    };
    const resources: Resource[] = [
      { name: "BE-Noha", type: "BE" },
      { name: "BE-Sara", type: "BE" },
      { name: "FE-Mina", type: "FE" },
      { name: "FE-Yara", type: "FE" },
      { name: "QC-Hoda", type: "QC" },
    ];
    const tasks: Task[] = [
      {
        id: "story-a",
        storyName: "Checkout Refactor",
        storyLink: "https://example.com/story-a",
        poPriority: 1,
        beDevs: ["BE-Noha"],
        beHours: 16,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["FE-Mina"],
        feHours: 8,
        integrationHours: 4,
        integrationFlags: { needsDevOps: true, needsCdc: false, needsDbSync: false, needsOtherSquad: false, needsThirdParty: false },
        qcs: ["QC-Hoda"],
        qcHours: 6,
        bufferHours: 2,
        status: "TODO",
      },
      {
        id: "story-b",
        storyName: "Address Validation",
        storyLink: "https://example.com/story-b",
        poPriority: null,
        beDevs: ["BE-Noha", "BE-Sara"],
        beHours: 14,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["FE-Yara"],
        feHours: 12,
        integrationHours: 2,
        integrationFlags: { needsDevOps: false, needsCdc: true, needsDbSync: false, needsOtherSquad: false, needsThirdParty: false },
        qcs: ["QC-Hoda"],
        qcHours: 4,
        bufferHours: 0,
        status: "InProgress",
      },
      {
        id: "story-c",
        storyName: "Payment Failure Retry",
        storyLink: "https://example.com/story-c",
        poPriority: null,
        beDevs: ["BE-Sara"],
        beHours: 10,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["FE-Mina", "FE-Yara"],
        feHours: 10,
        integrationHours: 8,
        integrationFlags: { needsDevOps: false, needsCdc: false, needsDbSync: true, needsOtherSquad: true, needsThirdParty: false },
        qcs: ["QC-Hoda"],
        qcHours: 8,
        bufferHours: 4,
        status: "Testing",
      },
      {
        id: "story-d",
        storyName: "Promo Banner",
        storyLink: "https://example.com/story-d",
        poPriority: null,
        beDevs: [],
        beHours: 5,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: [],
        feHours: 6,
        integrationHours: 1,
        integrationFlags: { needsDevOps: false, needsCdc: false, needsDbSync: false, needsOtherSquad: false, needsThirdParty: false },
        qcs: [],
        qcHours: 3,
        bufferHours: 1,
        status: "TODO",
      },
    ];

    const result = schedule(tasks, resources, complexConfig);
    const byId = new Map(result.tasks.map((task) => [task.id, task]));
    const storyA = byId.get("story-a");
    const storyB = byId.get("story-b");
    const storyC = byId.get("story-c");
    const storyD = byId.get("story-d");

    expect(storyA).toBeDefined();
    expect(storyB).toBeDefined();
    expect(storyC).toBeDefined();
    expect(storyD).toBeDefined();

    [storyA, storyB, storyC, storyD].forEach((task) => {
      expect(task?.releaseDate).not.toBeNull();
      expect(task?.releaseDate?.getDay()).not.toBe(5);
      expect(task?.releaseDate?.getDay()).not.toBe(6);
      expect(complexConfig.extraHolidays).not.toContain(dateKey(task!.releaseDate!));
      expect(task?.releaseDate!.getTime()).toBeGreaterThanOrEqual(task!.qcEnd!.getTime());
    });

    expect(storyA!.integrationStart).not.toBeNull();
    expect(storyA!.integrationEnd).not.toBeNull();
    const storyADevEnd = Math.max(storyA!.feEnd!.getTime(), storyA!.beEnd!.getTime());
    expect(storyA!.integrationStart!.getTime()).toBe(storyADevEnd);
    expect(storyA!.integrationEnd!.getTime()).toBeGreaterThan(storyA!.integrationStart!.getTime());

    expect(storyB!.beBlocks).toHaveLength(2);
    expect(storyB!.beBlocks.reduce((sum, item) => sum + item.hours, 0)).toBeCloseTo(14, 5);
    expect(storyB!.beBlocks[0].resourceName).not.toBe(storyB!.beBlocks[1].resourceName);

    expect(storyD!.feBlocks[0].resourceName).toBe("Unassigned-FE");
    expect(storyD!.beBlocks[0].resourceName).toBe("Unassigned-BE");
    expect(storyD!.qcBlocks[0].resourceName).toBe("Unassigned-QC");

    const qcBlocks = result.tasks
      .flatMap((task) => task.qcBlocks)
      .filter((block) => block.resourceName === "QC-Hoda")
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let index = 1; index < qcBlocks.length; index += 1) {
      expect(qcBlocks[index].start.getTime()).toBeGreaterThanOrEqual(qcBlocks[index - 1].end.getTime());
    }
  });

  it("front-loads smaller TODO stories when max release time is tied (earliestStoriesFirst vs legacy)", () => {
    const sharedConfigBase: Config = {
      sprintStartDate: "2026-05-04",
      planningSunday: "2026-05-03",
      extraHolidays: [],
      hoursPerDay: 8,
      sprintWorkingDays: 10,
      theme: "ocean",
      workdayStartHour: 9,
    };
    const resources: Resource[] = [
      { name: "BE-1", type: "BE" },
      { name: "FE-1", type: "FE" },
      { name: "QC-1", type: "QC" },
    ];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tiny: Task = {
      id: "tiny",
      storyName: "Tiny",
      storyLink: "",
      poPriority: null,
      feDevs: ["FE-1"],
      feHours: 2,
      beDevs: ["BE-1"],
      beHours: 2,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
      integrationHours: 0,
      integrationFlags: flags,
      qcs: ["QC-1"],
      qcHours: 2,
      bufferHours: 0,
      status: "TODO",
    };
    const heavy: Task = {
      id: "heavy",
      storyName: "Heavy",
      storyLink: "",
      poPriority: null,
      feDevs: ["FE-1"],
      feHours: 40,
      beDevs: ["BE-1"],
      beHours: 40,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
      integrationHours: 0,
      integrationFlags: flags,
      qcs: ["QC-1"],
      qcHours: 48,
      bufferHours: 0,
      status: "TODO",
    };
    const taskInput: Task[] = [heavy, tiny];

    const legacy = schedule(taskInput, resources, { ...sharedConfigBase, releaseStrategy: "latestReleaseOnly" });
    const optimized = schedule(taskInput, resources, { ...sharedConfigBase, releaseStrategy: "earliestStoriesFirst" });

    const legacyLast = Math.max(...legacy.tasks.map((t) => t.releaseDate?.getTime() ?? 0));
    const optimizedLast = Math.max(...optimized.tasks.map((t) => t.releaseDate?.getTime() ?? 0));
    expect(optimizedLast).toBe(legacyLast);

    const legacyIds = legacy.tasks.map((t) => t.id);
    expect(legacyIds.indexOf("heavy")).toBeLessThan(legacyIds.indexOf("tiny"));

    const legacyTinyRelease = legacy.tasks.find((task) => task.id === "tiny")?.releaseDate?.getTime() ?? 0;
    const optimizedTinyRelease = optimized.tasks.find((task) => task.id === "tiny")?.releaseDate?.getTime() ?? 0;
    expect(optimizedTinyRelease).toBeLessThanOrEqual(legacyTinyRelease);
  });

  it("schedules Mobile in parallel with FE and BE from the sprint epoch", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE" },
      { name: "FE-1", type: "FE" },
      { name: "MO-1", type: "MO" },
      { name: "QC-1", type: "QC" },
    ];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tasks: Task[] = [
      {
        id: "parallel-mo",
        storyName: "Parallel Mobile",
        storyLink: "",
        poPriority: 1,
        feDevs: ["FE-1"],
        feHours: 8,
        beDevs: ["BE-1"],
        beHours: 8,
        androidDevs: ["MO-1"],
        androidHours: 8,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        moStartDate: null,
        integrationHours: 8,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 0,
        bufferHours: 0,
        status: "TODO",
      },
    ];

    const result = schedule(tasks, resources, config);
    const scheduled = result.tasks[0];

    expect(scheduled.feStart?.getTime()).toBe(scheduled.beStart?.getTime());
    expect(scheduled.androidStart?.getTime()).toBe(scheduled.feStart?.getTime());
    expect(scheduled.androidBlocks.reduce((sum, block) => sum + block.hours, 0)).toBeCloseTo(8, 5);
    expect(scheduled.integrationStart?.getTime()).toBe(scheduled.feEnd?.getTime());
    expect(scheduled.integrationStart?.getTime()).toBe(scheduled.androidEnd?.getTime());
  });

  it("waits for Mobile before Integration when MO outlasts FE and BE", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE" },
      { name: "FE-1", type: "FE" },
      { name: "MO-1", type: "MO" },
      { name: "QC-1", type: "QC" },
    ];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tasks: Task[] = [
      {
        id: "long-mo",
        storyName: "Long Mobile",
        storyLink: "",
        poPriority: 1,
        feDevs: ["FE-1"],
        feHours: 8,
        beDevs: ["BE-1"],
        beHours: 8,
        androidDevs: ["MO-1"],
        androidHours: 16,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        moStartDate: null,
        integrationHours: 4,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 0,
        bufferHours: 0,
        status: "TODO",
      },
    ];

    const result = schedule(tasks, resources, config);
    const scheduled = result.tasks[0];

    expect(scheduled.feEnd!.getTime()).toBeLessThan(scheduled.androidEnd!.getTime());
    expect(scheduled.integrationStart?.getTime()).toBe(scheduled.androidEnd?.getTime());
    expect(scheduled.devEnd?.getTime()).toBe(scheduled.androidEnd?.getTime());
  });

  it("delays only Mobile when moStartDate is set", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE" },
      { name: "FE-1", type: "FE" },
      { name: "MO-1", type: "MO" },
      { name: "QC-1", type: "QC" },
    ];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tasks: Task[] = [
      {
        id: "delayed-mo",
        storyName: "Delayed Mobile",
        storyLink: "",
        poPriority: 1,
        feDevs: ["FE-1"],
        feHours: 8,
        beDevs: ["BE-1"],
        beHours: 8,
        androidDevs: ["MO-1"],
        androidHours: 8,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        moStartDate: "2026-04-29",
        integrationHours: 4,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 0,
        bufferHours: 0,
        status: "TODO",
      },
    ];

    const result = schedule(tasks, resources, config);
    const scheduled = result.tasks[0];

    expect(dateKey(scheduled.feStart!)).toBe("2026-04-27");
    expect(dateKey(scheduled.beStart!)).toBe("2026-04-27");
    expect(dateKey(scheduled.androidStart!)).toBe("2026-04-29");
    expect(scheduled.androidStart!.getTime()).toBeGreaterThan(scheduled.feStart!.getTime());
    expect(scheduled.integrationStart?.getTime()).toBe(scheduled.androidEnd?.getTime());
    expect(scheduled.integrationStart!.getTime()).toBeGreaterThan(scheduled.feEnd!.getTime());
  });

  it("schedules Android and iOS in parallel when needsIos is true", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE" },
      { name: "FE-1", type: "FE" },
      { name: "Attar", type: "MO" },
      { name: "Hassan", type: "MO" },
      { name: "QC-1", type: "QC" },
    ];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tasks: Task[] = [
      {
        id: "android-ios",
        storyName: "Both platforms",
        storyLink: "",
        poPriority: 1,
        feDevs: ["FE-1"],
        feHours: 0,
        beDevs: ["BE-1"],
        beHours: 0,
        androidDevs: ["Attar"],
        androidHours: 8,
        iosDevs: ["Hassan"],
        iosHours: 16,
        needsIos: true,
        moStartDate: null,
        integrationHours: 4,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 0,
        bufferHours: 0,
        status: "TODO",
      },
    ];

    const result = schedule(tasks, resources, config);
    const scheduled = result.tasks[0];

    expect(scheduled.androidStart?.getTime()).toBe(scheduled.iosStart?.getTime());
    expect(scheduled.iosEnd!.getTime()).toBeGreaterThan(scheduled.androidEnd!.getTime());
    expect(scheduled.integrationStart?.getTime()).toBe(scheduled.iosEnd?.getTime());
  });

  it("skips iOS work when needsIos is false even if iosHours are set", () => {
    const resources: Resource[] = [
      { name: "Attar", type: "MO" },
      { name: "Hassan", type: "MO" },
      { name: "QC-1", type: "QC" },
    ];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tasks: Task[] = [
      {
        id: "android-only",
        storyName: "Android only",
        storyLink: "",
        poPriority: 1,
        feDevs: [],
        feHours: 0,
        beDevs: [],
        beHours: 0,
        androidDevs: ["Attar"],
        androidHours: 8,
        iosDevs: ["Hassan"],
        iosHours: 40,
        needsIos: false,
        moStartDate: null,
        integrationHours: 0,
        integrationFlags: flags,
        qcs: ["QC-1"],
        qcHours: 0,
        bufferHours: 0,
        status: "TODO",
      },
    ];

    const result = schedule(tasks, resources, config);
    const scheduled = result.tasks[0];

    expect(scheduled.iosBlocks).toHaveLength(0);
    expect(scheduled.iosStart).toBeNull();
    expect(scheduled.androidBlocks.reduce((sum, block) => sum + block.hours, 0)).toBeCloseTo(8, 5);
  });

  it("schedules large todo boards quickly without O(n^2) greedy search", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE" },
      { name: "FE-1", type: "FE" },
      { name: "QC-1", type: "QC" },
    ];
    const flags = {
      needsDevOps: false,
      needsCdc: false,
      needsDbSync: false,
      needsOtherSquad: false,
      needsThirdParty: false,
    };
    const tasks: Task[] = Array.from({ length: 80 }, (_, index) => ({
      id: `todo-${index}`,
      storyName: `Todo ${index}`,
      storyLink: "",
      poPriority: null,
      feDevs: ["FE-1"],
      feHours: 4 + (index % 5),
      beDevs: ["BE-1"],
      beHours: 4 + (index % 7),
      androidDevs: [],
      androidHours: 0,
      iosDevs: [],
      iosHours: 0,
      needsIos: false,
      integrationHours: 0,
      integrationFlags: flags,
      qcs: ["QC-1"],
      qcHours: 4,
      bufferHours: 0,
      status: "TODO",
    }));

    const started = performance.now();
    const result = schedule(tasks, resources, {
      ...config,
      releaseStrategy: "earliestStoriesFirst",
    });
    const elapsedMs = performance.now() - started;

    expect(result.tasks).toHaveLength(80);
    expect(elapsedMs).toBeLessThan(2_000);
  });
});

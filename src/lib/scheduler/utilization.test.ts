import { describe, expect, it } from "vitest";
import { totalWorkingHoursForSprint } from "./calendar";
import { computeSprintUtilizationFromTasks, computeUtilization } from "./utilization";
import type { Config, Resource, ScheduleResult, Task } from "./types";

const config: Config = {
  sprintStartDate: "2026-04-26",
  planningSunday: "2026-04-26",
  extraHolidays: [],
  hoursPerDay: 8,
  sprintWorkingDays: 10,
  theme: "ocean",
  workdayStartHour: 9,
};

const defaultFlags = {
  needsDevOps: false,
  needsCdc: false,
  needsDbSync: false,
  needsOtherSquad: false,
  needsThirdParty: false,
};

describe("computeSprintUtilizationFromTasks", () => {
  it("counts assigned hours regardless of task state but excludes next-sprint carry tasks", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
      { name: "FE-1", type: "FE", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
      { name: "QC-1", type: "QC", ownershipMode: "shared", ourSquadHours: 40, capacityHours: 40 },
    ];
    const tasks: Task[] = [
      {
        id: "todo-task",
        storyName: "TODO story",
        storyLink: "",
        poPriority: null,
        beDevs: ["BE-1"],
        beHours: 10,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["FE-1"],
        feHours: 8,
        integrationHours: 3,
        integrationFlags: defaultFlags,
        qcs: ["QC-1"],
        qcHours: 6,
        bufferHours: 2,
        status: "TODO",
      },
      {
        id: "released-task",
        storyName: "Released story",
        storyLink: "",
        poPriority: null,
        beDevs: ["BE-1"],
        beHours: 4,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["FE-1"],
        feHours: 6,
        integrationHours: 2,
        integrationFlags: defaultFlags,
        qcs: ["QC-1"],
        qcHours: 5,
        bufferHours: 1,
        status: "Released",
      },
      {
        id: "carry-task",
        storyName: "Carry to next sprint",
        storyLink: "",
        poPriority: null,
        beDevs: ["BE-1"],
        beHours: 40,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["FE-1"],
        feHours: 40,
        integrationHours: 10,
        integrationFlags: defaultFlags,
        qcs: ["QC-1"],
        qcHours: 40,
        bufferHours: 6,
        carryToNextSprint: true,
        status: "InProgress",
      },
      {
        id: "discoped-task",
        storyName: "Discoped story",
        storyLink: "",
        poPriority: null,
        beDevs: ["BE-1"],
        beHours: 20,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["FE-1"],
        feHours: 20,
        integrationHours: 5,
        integrationFlags: defaultFlags,
        qcs: ["QC-1"],
        qcHours: 20,
        bufferHours: 2,
        status: "Discoped",
      },
    ];

    const result = computeSprintUtilizationFromTasks(tasks, resources, config);
    const be = result.perMember.find((entry) => entry.type === "BE" && entry.name === "BE-1");
    const fe = result.perMember.find((entry) => entry.type === "FE" && entry.name === "FE-1");
    const qc = result.perMember.find((entry) => entry.type === "QC" && entry.name === "QC-1");

    expect(be?.takenHours).toBe(34);
    expect(fe?.takenHours).toBe(34);
    expect(qc?.takenHours).toBe(31);
    expect(be?.remainingHours).toBe(6);
    expect(fe?.remainingHours).toBe(6);
    expect(qc?.remainingHours).toBe(9);
  });

  it("splits assignee hours and tracks integration/buffer at squad level", () => {
    const resources: Resource[] = [
      { name: "BE-1", type: "BE", ownershipMode: "shared", ourSquadHours: 20, capacityHours: 20 },
      { name: "BE-2", type: "BE", ownershipMode: "shared", ourSquadHours: 20, capacityHours: 20 },
      { name: "FE-1", type: "FE", ownershipMode: "shared", ourSquadHours: 20, capacityHours: 20 },
      { name: "QC-1", type: "QC", ownershipMode: "shared", ourSquadHours: 20, capacityHours: 20 },
    ];
    const tasks: Task[] = [
      {
        id: "split-story",
        storyName: "Split story",
        storyLink: "",
        poPriority: null,
        beDevs: ["BE-1", "BE-2"],
        beHours: 5,
        androidDevs: [],
        androidHours: 0,
        iosDevs: [],
        iosHours: 0,
        needsIos: false,
        feDevs: ["FE-1"],
        feHours: 3,
        integrationHours: 4,
        integrationFlags: defaultFlags,
        qcs: ["QC-1"],
        qcHours: 2,
        bufferHours: 1.5,
        status: "Testing",
      },
    ];

    const result = computeSprintUtilizationFromTasks(tasks, resources, config);
    const be1 = result.perMember.find((entry) => entry.type === "BE" && entry.name === "BE-1");
    const be2 = result.perMember.find((entry) => entry.type === "BE" && entry.name === "BE-2");

    expect(be1?.takenHours).toBeCloseTo(2.5, 5);
    expect(be2?.takenHours).toBeCloseTo(2.5, 5);
    expect(result.squadTotals.integrationHours).toBe(4);
    expect(result.squadTotals.bufferHours).toBe(1.5);
    expect(result.squadTotals.totalHours).toBe(5.5);
  });

  it("uses fullyMine ownership as full working hours and shared as custom assigned hours", () => {
    const resources: Resource[] = [
      { name: "BE-Full", type: "BE", ownershipMode: "fullyMine" },
      { name: "BE-Shared", type: "BE", ownershipMode: "shared", ourSquadHours: 24 },
    ];
    const scheduleResult: ScheduleResult = {
      sprintEndDate: new Date("2026-05-07T17:00:00.000Z"),
      tasks: [
        {
          id: "story-1",
          storyName: "Story",
          storyLink: "",
          poPriority: null,
          status: "TODO" as const,
          feBlocks: [],
          beBlocks: [
            { resourceName: "BE-Full", start: new Date(), end: new Date(), hours: 12 },
            { resourceName: "BE-Shared", start: new Date(), end: new Date(), hours: 10 },
          ],
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
        },
      ],
    };

    const utilization = computeUtilization(resources, scheduleResult, config);
    const full = utilization.find((entry) => entry.name === "BE-Full");
    const shared = utilization.find((entry) => entry.name === "BE-Shared");
    const fullHours = totalWorkingHoursForSprint(config);

    expect(full?.assignedOurSquadHours).toBe(fullHours);
    expect(full?.takenHours).toBe(12);
    expect(shared?.assignedOurSquadHours).toBe(24);
    expect(shared?.remainingHours).toBe(14);
  });

  it("calculates total working hours excluding biweekly planning day and vacations", () => {
    const policyConfig: Config = {
      sprintStartDate: "2026-05-03",
      planningSunday: "2026-05-03",
      extraHolidays: ["2026-05-07"],
      hoursPerDay: 6,
      sprintWorkingDays: 10,
      theme: "ocean",
      workdayStartHour: 11,
    };
    expect(totalWorkingHoursForSprint(policyConfig)).toBe(48);
  });

  it("allocates Mobile hours from androidBlocks", () => {
    const resources: Resource[] = [
      { name: "MO-1", type: "MO", ownershipMode: "fullyMine" },
    ];
    const scheduleResult: ScheduleResult = {
      sprintEndDate: new Date("2026-05-07T17:00:00.000Z"),
      tasks: [
        {
          id: "story-mo",
          storyName: "Mobile story",
          storyLink: "",
          poPriority: null,
          status: "TODO" as const,
          feBlocks: [],
          beBlocks: [],
          androidBlocks: [{ resourceName: "MO-1", start: new Date(), end: new Date(), hours: 14 }],
          iosBlocks: [],
          feStart: null,
          feEnd: null,
          beStart: null,
          beEnd: null,
          androidStart: null,
          androidEnd: null,
          iosStart: null,
          iosEnd: null,
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
        },
      ],
    };

    const utilization = computeUtilization(resources, scheduleResult, config);
    expect(utilization.find((entry) => entry.name === "MO-1")?.takenHours).toBe(14);
  });
});

import { describe, expect, it } from "vitest";
import { alignReleaseGroups, clampReleaseDatesToWorkEnd } from "./releaseGroups";
import type { Config, ScheduledTask, Task } from "./types";

const config: Config = {
  sprintStartDate: "2026-04-27",
  planningSunday: "2026-04-27",
  extraHolidays: [],
  hoursPerDay: 8,
  sprintWorkingDays: 10,
  theme: "ocean",
  workdayStartHour: 9,
};

const scheduled = (
  id: string,
  uat: Date,
  production: Date,
  releaseGroup: string | null = null,
  extras: Partial<ScheduledTask> = {},
): ScheduledTask => ({
  id,
  storyName: id,
  storyLink: "",
  poPriority: null,
  status: "Testing",
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
  qcEnd: extras.qcEnd ?? null,
  bufferStart: null,
  bufferEnd: extras.bufferEnd ?? null,
  uatReleaseDate: uat,
  productionReleaseDate: production,
  releaseDate: uat,
  isThursdayRelease: false,
  thursdayReleaseScope: "none",
  isOverflow: false,
  releaseGroup,
  ...extras,
});

describe("alignReleaseGroups", () => {
  it("aligns UAT and production dates to the latest scheduled story in the same release group", () => {
    const earlyUat = new Date("2026-05-05T13:00:00.000Z");
    const lateUat = new Date("2026-05-10T16:00:00.000Z");
    const earlyProd = new Date("2026-05-06T10:00:00.000Z");
    const lateProd = new Date("2026-05-11T10:00:00.000Z");

    const sourceTasks: Task[] = [
      {
        id: "a",
        storyName: "A",
        storyLink: "",
        poPriority: null,
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
        qcs: [],
        qcHours: 0,
        status: "Testing",
        releaseGroup: "Counter Hub",
      },
      {
        id: "b",
        storyName: "B",
        storyLink: "",
        poPriority: null,
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
        qcs: [],
        qcHours: 0,
        status: "Testing",
        releaseGroup: "Counter Hub",
      },
    ];

    const aligned = alignReleaseGroups(
      sourceTasks,
      [scheduled("a", earlyUat, earlyProd, "Counter Hub"), scheduled("b", lateUat, lateProd, "Counter Hub")],
      config,
      new Date("2026-05-14T17:00:00.000Z"),
    );

    expect(aligned[0].releaseDate?.toISOString()).toBe(lateUat.toISOString());
    expect(aligned[1].releaseDate?.toISOString()).toBe(lateUat.toISOString());
    expect(aligned[0].productionReleaseDate?.toISOString()).toBe(aligned[1].productionReleaseDate?.toISOString());
  });

  it("uses the latest scheduled UAT (with real QC contention), not an optimistic hours-only estimate", () => {
    const earlyOptimistic = new Date("2026-06-05T12:00:00.000Z");
    const aliceFinishes = new Date("2026-08-11T15:00:00.000Z");
    const earlyProd = new Date("2026-06-06T10:00:00.000Z");
    const lateProd = new Date("2026-08-12T10:00:00.000Z");

    const sourceTasks: Task[] = [
      {
        id: "short",
        storyName: "Short",
        storyLink: "",
        poPriority: 1,
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
        qcs: ["Alice"],
        qcHours: 3,
        status: "Testing",
        releaseGroup: "CounterHub",
      },
      {
        id: "long",
        storyName: "Long",
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
        qcs: ["Alice"],
        qcHours: 16,
        status: "Testing",
        releaseGroup: "CounterHub",
      },
    ];

    const aligned = alignReleaseGroups(
      sourceTasks,
      [
        scheduled("short", earlyOptimistic, earlyProd, "CounterHub", {
          qcEnd: earlyOptimistic,
          bufferEnd: earlyOptimistic,
        }),
        scheduled("long", aliceFinishes, lateProd, "CounterHub", {
          qcEnd: aliceFinishes,
          bufferEnd: aliceFinishes,
        }),
      ],
      config,
      new Date("2026-08-20T17:00:00.000Z"),
    );

    // Shared UAT is resolveUatReleaseDate(Alice's scheduled end), never the early optimistic date.
    expect(aligned[0].uatReleaseDate!.getTime()).toBeGreaterThanOrEqual(aliceFinishes.getTime());
    expect(aligned[1].uatReleaseDate!.getTime()).toBe(aligned[0].uatReleaseDate!.getTime());
    expect(aligned[0].uatReleaseDate!.getTime()).toBeGreaterThan(earlyOptimistic.getTime());
  });

  it("clears release dates for UAT+ members pending on PM without blocking siblings", () => {
    const testingUat = new Date("2026-05-10T16:00:00.000Z");
    const testingProd = new Date("2026-05-11T10:00:00.000Z");
    const aligned = alignReleaseGroups(
      [],
      [
        scheduled("pm-owned", testingUat, testingProd, "Wave", {
          status: "UAT",
          bufferEnd: testingUat,
        }),
        scheduled("still-testing", testingUat, testingProd, "Wave", {
          status: "Testing",
          bufferEnd: testingUat,
        }),
      ],
      config,
      new Date("2026-05-14T17:00:00.000Z"),
    );

    const pending = aligned.find((task) => task.id === "pm-owned")!;
    const testing = aligned.find((task) => task.id === "still-testing")!;
    expect(pending.releaseDate).toBeNull();
    expect(pending.uatReleaseDate).toBeNull();
    expect(testing.releaseDate).not.toBeNull();
  });
});

describe("clampReleaseDatesToWorkEnd", () => {
  it("pushes UAT forward when it is earlier than QC/buffer end", () => {
    const qcEnd = new Date("2026-08-11T15:00:00.000Z");
    const tooEarlyUat = new Date("2026-07-29T12:00:00.000Z");
    const clamped = clampReleaseDatesToWorkEnd(
      scheduled("story", tooEarlyUat, new Date("2026-07-30T10:00:00.000Z"), null, {
        qcEnd,
        bufferEnd: qcEnd,
      }),
      config,
    );
    expect(clamped.uatReleaseDate!.getTime()).toBeGreaterThanOrEqual(qcEnd.getTime());
    expect(clamped.releaseDate!.getTime()).toBe(clamped.uatReleaseDate!.getTime());
  });

  it("clears release dates when status is pending on EM", () => {
    const bufferEnd = new Date("2026-08-11T15:00:00.000Z");
    const clamped = clampReleaseDatesToWorkEnd(
      scheduled("story", bufferEnd, new Date("2026-08-12T10:00:00.000Z"), null, {
        status: "Ready for Production",
        bufferEnd,
      }),
      config,
    );
    expect(clamped.releaseDate).toBeNull();
    expect(clamped.uatReleaseDate).toBeNull();
    expect(clamped.productionReleaseDate).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { Task } from "./types";
import { resolveRemainingEffort } from "./remainingEffort";

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  storyName: "Story",
  storyLink: "",
  poPriority: null,
  feDevs: ["FE-1"],
  feHours: 8,
  beDevs: ["BE-1"],
  beHours: 6,
  androidDevs: ["MO-1"],
  androidHours: 4,
  iosDevs: [],
  iosHours: 0,
  needsIos: false,
  moStartDate: null,
  integrationHours: 2,
  qcs: ["QC-1"],
  qcHours: 4,
  productManagers: [],
  bufferHours: 1,
  status: "InProgress",
  ...overrides,
});

describe("resolveRemainingEffort", () => {
  it("keeps all phases from Start", () => {
    expect(resolveRemainingEffort(baseTask({ replanFromStep: "Start" }))).toEqual({
      feHours: 8,
      beHours: 6,
      androidHours: 4,
      iosHours: 0,
      integrationHours: 2,
      qcHours: 4,
      bufferHours: 1,
    });
  });

  it("zeros BE from FE step", () => {
    expect(resolveRemainingEffort(baseTask({ replanFromStep: "FE" }))).toEqual({
      feHours: 8,
      beHours: 0,
      androidHours: 4,
      iosHours: 0,
      integrationHours: 2,
      qcHours: 4,
      bufferHours: 1,
    });
  });

  it("includes iOS hours when needsIos is true", () => {
    expect(
      resolveRemainingEffort(
        baseTask({ replanFromStep: "Start", needsIos: true, iosHours: 5, iosDevs: ["MO-1"] }),
      ),
    ).toEqual({
      feHours: 8,
      beHours: 6,
      androidHours: 4,
      iosHours: 5,
      integrationHours: 2,
      qcHours: 4,
      bufferHours: 1,
    });
  });

  it("zeros FE/BE/Mobile from Integration", () => {
    expect(resolveRemainingEffort(baseTask({ replanFromStep: "Integration" }))).toEqual({
      feHours: 0,
      beHours: 0,
      androidHours: 0,
      iosHours: 0,
      integrationHours: 2,
      qcHours: 4,
      bufferHours: 1,
    });
  });

  it("keeps QC and buffer from QC step", () => {
    expect(resolveRemainingEffort(baseTask({ replanFromStep: "QC" }))).toEqual({
      feHours: 0,
      beHours: 0,
      androidHours: 0,
      iosHours: 0,
      integrationHours: 0,
      qcHours: 4,
      bufferHours: 1,
    });
  });

  it("keeps only buffer from Buffer step", () => {
    expect(resolveRemainingEffort(baseTask({ replanFromStep: "Buffer" }))).toEqual({
      feHours: 0,
      beHours: 0,
      androidHours: 0,
      iosHours: 0,
      integrationHours: 0,
      qcHours: 0,
      bufferHours: 1,
    });
  });

  it("zeros everything for Released", () => {
    expect(resolveRemainingEffort(baseTask({ status: "Released", replanFromStep: "Start" }))).toEqual({
      feHours: 0,
      beHours: 0,
      androidHours: 0,
      iosHours: 0,
      integrationHours: 0,
      qcHours: 0,
      bufferHours: 0,
    });
  });
});

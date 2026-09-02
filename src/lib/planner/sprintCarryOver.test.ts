import { describe, expect, it } from "vitest";
import {
  applyFullEstimateToDevRow,
  carryOverridesFromWizardRows,
  listCarryWizardRows,
  validateCarryWizardRows,
  type CarryWizardRow,
} from "./sprintCarryOver";
import type { Task } from "@/lib/scheduler/types";

const baseTask = (overrides: Partial<Task>): Task => ({
  id: "t1",
  storyName: "Story",
  storyLink: "",
  poPriority: null,
  feDevs: ["FE"],
  feHours: 8,
  beDevs: ["BE"],
  beHours: 10,
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
  qcs: ["QC"],
  qcHours: 4,
  bufferHours: 0,
  status: "In Progress",
  ...overrides,
});

describe("sprintCarryOver", () => {
  it("lists dev and qc carry rows for current sprint only", () => {
    const rows = listCarryWizardRows([
      baseTask({ id: "dev", status: "In Progress" }),
      baseTask({ id: "qc", status: "Testing", qcHours: 6 }),
      baseTask({ id: "parked", carryToNextSprint: true, status: "Testing" }),
      baseTask({ id: "uat", status: "UAT" }),
    ]);
    expect(rows.map((row) => row.taskId)).toEqual(["dev", "qc"]);
    expect(rows.find((row) => row.taskId === "qc")?.kind).toBe("qc");
  });

  it("maps wizard rows to remaining overrides", () => {
    const rows: CarryWizardRow[] = [
      {
        taskId: "dev",
        storyName: "Dev",
        status: "In Progress",
        kind: "dev",
        useFullEstimate: false,
        fe: 4,
        be: 3,
        android: 0,
        ios: 0,
        qc: 2,
        integration: 0,
        buffer: 0,
        defaultFe: 4,
        defaultBe: 3,
        defaultAndroid: 0,
        defaultIos: 0,
        defaultQc: 2,
        defaultIntegration: 0,
        defaultBuffer: 0,
        estimateFe: 8,
        estimateBe: 10,
        estimateAndroid: 0,
        estimateIos: 0,
        estimateQc: 4,
        estimateIntegration: 0,
        estimateBuffer: 0,
      },
    ];
    const overrides = carryOverridesFromWizardRows(rows);
    expect(overrides.dev?.remainingBeHours).toBe(3);
    expect(overrides.dev?.remainingFeHours).toBe(4);
  });

  it("rejects remaining above estimate", () => {
    const rows = listCarryWizardRows([baseTask({ id: "dev" })]);
    rows[0].be = 99;
    expect(validateCarryWizardRows(rows)).toMatch(/BE remaining exceeds estimate/);
  });

  it("fills full estimates when dev was untouched last sprint", () => {
    const rows = listCarryWizardRows([
      baseTask({ id: "dev", replanFromStep: "FE", feHours: 8, beHours: 10, qcHours: 4 }),
    ]);
    expect(rows[0].be).toBe(0);
    const full = applyFullEstimateToDevRow(rows[0]);
    expect(full.useFullEstimate).toBe(true);
    expect(full.fe).toBe(8);
    expect(full.be).toBe(10);
    expect(full.qc).toBe(4);
  });
});

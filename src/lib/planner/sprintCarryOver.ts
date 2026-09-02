import { resolveRemainingEffort } from "@/lib/scheduler/remainingEffort";
import type { Task } from "@/lib/scheduler/types";
import {
  isDevCarryWizardStatus,
  isQcCarryWizardStatus,
  remainingOverridesFromEffort,
  type TaskRemainingOverrides,
} from "@/lib/scheduler/utilizationEffort";

export type CarryWizardKind = "dev" | "qc";

export type CarryWizardRow = {
  taskId: string;
  storyName: string;
  status: string;
  kind: CarryWizardKind;
  /** When true, remaining = full estimates (dev phases untouched last sprint). */
  useFullEstimate: boolean;
  fe: number;
  be: number;
  android: number;
  ios: number;
  qc: number;
  integration: number;
  buffer: number;
  defaultFe: number;
  defaultBe: number;
  defaultAndroid: number;
  defaultIos: number;
  defaultQc: number;
  defaultIntegration: number;
  defaultBuffer: number;
  estimateFe: number;
  estimateBe: number;
  estimateAndroid: number;
  estimateIos: number;
  estimateQc: number;
  estimateIntegration: number;
  estimateBuffer: number;
};

export type StartNewSprintCarryInput = Record<string, TaskRemainingOverrides>;

const fullEstimateHours = (
  estimates: Pick<
    CarryWizardRow,
    | "estimateFe"
    | "estimateBe"
    | "estimateAndroid"
    | "estimateIos"
    | "estimateQc"
    | "estimateIntegration"
    | "estimateBuffer"
  >,
) => ({
  fe: estimates.estimateFe,
  be: estimates.estimateBe,
  android: estimates.estimateAndroid,
  ios: estimates.estimateIos,
  qc: estimates.estimateQc,
  integration: estimates.estimateIntegration,
  buffer: estimates.estimateBuffer,
});

const statusRemainingHours = (
  defaults: Pick<
    CarryWizardRow,
    "defaultFe" | "defaultBe" | "defaultAndroid" | "defaultIos" | "defaultQc" | "defaultIntegration" | "defaultBuffer"
  >,
) => ({
  fe: defaults.defaultFe,
  be: defaults.defaultBe,
  android: defaults.defaultAndroid,
  ios: defaults.defaultIos,
  qc: defaults.defaultQc,
  integration: defaults.defaultIntegration,
  buffer: defaults.defaultBuffer,
});

/** Apply full story estimates as if dev work was not consumed last sprint. */
export const applyFullEstimateToDevRow = (row: CarryWizardRow): CarryWizardRow => {
  if (row.kind !== "dev") {
    return row;
  }
  return {
    ...row,
    useFullEstimate: true,
    ...fullEstimateHours(row),
  };
};

/** Revert to status/replan-based remaining defaults. */
export const applyStatusRemainingToDevRow = (row: CarryWizardRow): CarryWizardRow => {
  if (row.kind !== "dev") {
    return row;
  }
  return {
    ...row,
    useFullEstimate: false,
    ...statusRemainingHours(row),
  };
};

export const toggleDevRowFullEstimate = (row: CarryWizardRow, useFull: boolean): CarryWizardRow =>
  useFull ? applyFullEstimateToDevRow(row) : applyStatusRemainingToDevRow(row);

export const applyFullEstimateToAllDevRows = (rows: CarryWizardRow[]): CarryWizardRow[] =>
  rows.map((row) => (row.kind === "dev" ? applyFullEstimateToDevRow(row) : row));

export const listCarryWizardRows = (tasks: Task[]): CarryWizardRow[] => {
  const rows: CarryWizardRow[] = [];
  for (const task of tasks) {
    if (task.carryToNextSprint) {
      continue;
    }
    const defaults = resolveRemainingEffort(task);
    if (isQcCarryWizardStatus(task.status)) {
      rows.push({
        taskId: task.id,
        storyName: task.storyName || task.storyLink || task.id,
        status: task.status,
        kind: "qc",
        useFullEstimate: false,
        fe: 0,
        be: 0,
        android: 0,
        ios: 0,
        qc: defaults.qcHours,
        integration: 0,
        buffer: 0,
        defaultFe: 0,
        defaultBe: 0,
        defaultAndroid: 0,
        defaultIos: 0,
        defaultQc: defaults.qcHours,
        defaultIntegration: 0,
        defaultBuffer: 0,
        estimateFe: task.feHours,
        estimateBe: task.beHours,
        estimateAndroid: task.androidHours ?? 0,
        estimateIos: task.iosHours ?? 0,
        estimateQc: task.qcHours,
        estimateIntegration: task.integrationHours,
        estimateBuffer: task.bufferHours ?? 0,
      });
      continue;
    }
    if (isDevCarryWizardStatus(task.status)) {
      rows.push({
        taskId: task.id,
        storyName: task.storyName || task.storyLink || task.id,
        status: task.status,
        kind: "dev",
        useFullEstimate: false,
        fe: defaults.feHours,
        be: defaults.beHours,
        android: defaults.androidHours,
        ios: defaults.iosHours,
        qc: defaults.qcHours,
        integration: defaults.integrationHours,
        buffer: defaults.bufferHours,
        defaultFe: defaults.feHours,
        defaultBe: defaults.beHours,
        defaultAndroid: defaults.androidHours,
        defaultIos: defaults.iosHours,
        defaultQc: defaults.qcHours,
        defaultIntegration: defaults.integrationHours,
        defaultBuffer: defaults.bufferHours,
        estimateFe: task.feHours,
        estimateBe: task.beHours,
        estimateAndroid: task.androidHours ?? 0,
        estimateIos: task.iosHours ?? 0,
        estimateQc: task.qcHours,
        estimateIntegration: task.integrationHours,
        estimateBuffer: task.bufferHours ?? 0,
      });
    }
  }
  return rows;
};

export const carryOverridesFromWizardRows = (rows: CarryWizardRow[]): StartNewSprintCarryInput => {
  const out: StartNewSprintCarryInput = {};
  for (const row of rows) {
    if (row.kind === "qc") {
      out[row.taskId] = remainingOverridesFromEffort({
        feHours: 0,
        beHours: 0,
        androidHours: 0,
        iosHours: 0,
        integrationHours: 0,
        qcHours: row.qc,
        bufferHours: 0,
      });
      continue;
    }
    out[row.taskId] = remainingOverridesFromEffort({
      feHours: row.fe,
      beHours: row.be,
      androidHours: row.android,
      iosHours: row.ios,
      integrationHours: row.integration,
      qcHours: row.qc,
      bufferHours: row.buffer,
    });
  }
  return out;
};

export const validateCarryWizardRows = (rows: CarryWizardRow[]): string | null => {
  for (const row of rows) {
    const values =
      row.kind === "qc"
        ? [row.qc]
        : [row.fe, row.be, row.android, row.ios, row.qc, row.integration, row.buffer];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      return `Invalid remaining hours for "${row.storyName}".`;
    }
    if (row.fe > row.estimateFe + 0.001) {
      return `FE remaining exceeds estimate for "${row.storyName}".`;
    }
    if (row.be > row.estimateBe + 0.001) {
      return `BE remaining exceeds estimate for "${row.storyName}".`;
    }
    if (row.qc > row.estimateQc + 0.001) {
      return `QC remaining exceeds estimate for "${row.storyName}".`;
    }
  }
  return null;
};

export const defaultCarryWizardRows = (tasks: Task[]): CarryWizardRow[] => listCarryWizardRows(tasks);

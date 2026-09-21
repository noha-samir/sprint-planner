import type { Task } from "@/lib/scheduler/types";
import { effectiveMobileHours } from "@/lib/scheduler/mobilePlatform";

export type TaskDetailsSummaryChip = {
  key: string;
  label: string;
};

/**
 * Compact chips for the collapsed Details column (skip empty phases).
 */
export function buildTaskDetailsSummaryChips(task: Task): TaskDetailsSummaryChip[] {
  const chips: TaskDetailsSummaryChip[] = [];
  const pushHours = (key: string, label: string, hours: number) => {
    if (!(hours > 0)) return;
    chips.push({ key, label: `${label} ${formatHoursShort(hours)}` });
  };

  pushHours("be", "BE", task.beHours);
  pushHours("fe", "FE", task.feHours);
  pushHours("mo", "MO", effectiveMobileHours(task));
  pushHours("int", "Int", task.integrationHours);
  pushHours("qc", "QC", task.qcHours);

  const pmCount = task.productManagers?.length ?? 0;
  if (pmCount > 0) {
    chips.push({ key: "pm", label: `PM ${pmCount}` });
  }

  const buffer = task.bufferHours ?? 0;
  if (buffer > 0) {
    chips.push({ key: "buf", label: `Buf ${formatHoursShort(buffer)}` });
  }

  return chips;
}

const formatHoursShort = (hours: number): string => {
  if (Number.isInteger(hours)) return String(hours);
  return String(Math.round(hours * 10) / 10);
};

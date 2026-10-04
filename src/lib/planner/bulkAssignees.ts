import {
  buildResourceSets,
  bulkGridSelectionSize,
  normalizeBulkGridSelection,
  parseEstimationHours,
  pasteTableIntoGridRange,
  resolveAssignees,
  type BulkGridAnchor,
  type BulkGridSelection,
  type ClipboardCell,
} from "@/lib/planner/bulkTaskPaste";
import { isStandaloneIssueType, isTechnicalTaskIssueType } from "@/lib/planner/taskIssueFilters";
import { DEFAULT_JIRA_STORY_STATUSES, normalizeTaskStatus } from "@/lib/scheduler/taskStatus";
import type { Resource, ResourceType, Task } from "@/lib/scheduler/types";

export type PeopleField = "beDevs" | "feDevs" | "androidDevs" | "iosDevs" | "qcs" | "productManagers";
export type HoursField = "beHours" | "feHours" | "androidHours" | "iosHours" | "qcHours" | "bufferHours";
export type StatusField = "status";
export type BulkEditField = StatusField | PeopleField | HoursField;

export type BulkEditColumn =
  | { kind: "status"; field: StatusField; label: string }
  | { kind: "people"; field: PeopleField; label: string; resourceType: ResourceType }
  | { kind: "hours"; field: HoursField; label: string };

/** Column order of the bulk grid (after the read-only Story column): status, then each role's people and hours. */
export const bulkEditColumns: readonly BulkEditColumn[] = [
  { kind: "status", field: "status", label: "Status" },
  { kind: "people", field: "beDevs", label: "BE", resourceType: "BE" },
  { kind: "hours", field: "beHours", label: "BE h" },
  { kind: "people", field: "feDevs", label: "FE", resourceType: "FE" },
  { kind: "hours", field: "feHours", label: "FE h" },
  { kind: "people", field: "androidDevs", label: "Android", resourceType: "MO" },
  { kind: "hours", field: "androidHours", label: "And h" },
  { kind: "people", field: "iosDevs", label: "iOS", resourceType: "MO" },
  { kind: "hours", field: "iosHours", label: "iOS h" },
  { kind: "people", field: "qcs", label: "QC", resourceType: "QC" },
  { kind: "hours", field: "qcHours", label: "QC h" },
  { kind: "people", field: "productManagers", label: "PM", resourceType: "PM" },
  { kind: "hours", field: "bufferHours", label: "Buff h" },
];

/** One editable grid row: status, comma-joined names and hour text per role for one story. */
export type BulkEditDraftRow = {
  taskId: string;
  technicalTask: boolean;
  bufferLocked: boolean;
} & Record<BulkEditField, string>;

export interface BulkEditPatchResult {
  patches: Array<{ id: string; patch: Partial<Task> }>;
  /** Unknown names / statuses / invalid hours in edited cells (they are skipped on save). */
  warnings: string[];
  /** `${taskId}:${field}` for edited cells with a problem. */
  warningCells: Set<string>;
}

const TECHNICAL_TASK_LOCKED_FIELDS: ReadonlySet<BulkEditField> = new Set(["beDevs", "feDevs", "beHours"]);

const joinNames = (names: readonly string[] | null | undefined): string => (names ?? []).join(", ");

const formatHours = (hours: number | null | undefined): string => (hours ? String(hours) : "");

const sameNames = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((name, index) => name === right[index]);

const storyLabel = (task: Task): string => task.storyName.trim() || task.storyLink.trim() || task.id;

const isValidHoursText = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) && value >= 0;
};

/**
 * Match typed / pasted status text to a planner status (case-insensitive, legacy names like TODO allowed).
 * @param raw - Cell text.
 * @returns The canonical status name, or null when it is not a planner status.
 */
export const resolveBulkEditStatus = (raw: string): string | null => {
  const status = normalizeTaskStatus(raw);
  return DEFAULT_JIRA_STORY_STATUSES.includes(status) ? status : null;
};

/**
 * Read-only cells: Technical Tasks have no BE/FE people and keep Dev hours in FE h (the store
 * folds BE hours into it), and buffer hours follow the dashboard's sprint-lifecycle permission.
 * @param row - Grid row.
 * @param field - Column field.
 */
export const isBulkEditCellLocked = (row: BulkEditDraftRow, field: BulkEditField): boolean =>
  (row.technicalTask && TECHNICAL_TASK_LOCKED_FIELDS.has(field)) || (row.bufferLocked && field === "bufferHours");

/**
 * Build the editable grid rows from tasks (names joined with ", ", zero hours shown empty).
 * @param tasks - Stories to edit, in display order.
 * @param options.canEditBuffer - Whether the user may change buffer hours.
 * @returns One draft row per task.
 */
export const buildBulkEditDraftRows = (
  tasks: readonly Task[],
  options: { canEditBuffer: boolean },
): BulkEditDraftRow[] =>
  tasks.map((task) => ({
    taskId: task.id,
    technicalTask: isTechnicalTaskIssueType(task.issueType),
    bufferLocked: !options.canEditBuffer,
    status: task.status,
    beDevs: joinNames(task.beDevs),
    beHours: formatHours(task.beHours),
    feDevs: joinNames(task.feDevs),
    feHours: formatHours(task.feHours),
    androidDevs: joinNames(task.androidDevs),
    androidHours: formatHours(task.androidHours),
    iosDevs: joinNames(task.iosDevs),
    iosHours: formatHours(task.iosHours),
    qcs: joinNames(task.qcs),
    qcHours: formatHours(task.qcHours),
    productManagers: joinNames(task.productManagers),
    bufferHours: formatHours(task.bufferHours),
  }));

const writeCell = (row: BulkEditDraftRow, colIndex: number, value: string): BulkEditDraftRow => {
  const field = bulkEditColumns[colIndex]?.field;
  // A story always has a status, so clearing / empty pastes leave it as is.
  if (!field || isBulkEditCellLocked(row, field) || (field === "status" && !value)) {
    return row;
  }
  return { ...row, [field]: value };
};

/**
 * Paste clipboard cells into the grid, Excel-style. With a multi-cell selection the clipboard
 * repeats over the selection (one value fills them all); otherwise it fills from the anchor.
 * Paste never adds rows and never writes locked cells.
 * @param drafts - Current grid rows.
 * @param table - Parsed clipboard cells.
 * @param anchor - Focused cell.
 * @param selection - Current selection, if any.
 * @returns Updated rows.
 */
export const applyBulkEditPaste = (
  drafts: BulkEditDraftRow[],
  table: ClipboardCell[][],
  anchor: BulkGridAnchor,
  selection: BulkGridSelection | null,
): BulkEditDraftRow[] => {
  if (table.length === 0) {
    return drafts;
  }
  const range =
    selection && bulkGridSelectionSize(selection) > 1
      ? selection
      : {
          startRow: anchor.rowIndex,
          startCol: anchor.colIndex,
          endRow: anchor.rowIndex + table.length - 1,
          endCol: anchor.colIndex + Math.max(...table.map((row) => row.length), 1) - 1,
        };
  return pasteTableIntoGridRange(drafts, table, range, (row, colIndex, cell) =>
    writeCell(row, colIndex, cell.text.trim()),
  );
};

/**
 * Clear every editable cell inside the selection.
 * @param drafts - Current grid rows.
 * @param selection - Selected range.
 * @returns Updated rows.
 */
export const clearBulkEditSelection = (
  drafts: BulkEditDraftRow[],
  selection: BulkGridSelection,
): BulkEditDraftRow[] => {
  const sel = normalizeBulkGridSelection(selection);
  return drafts.map((row, rowIndex) => {
    if (rowIndex < sel.startRow || rowIndex > sel.endRow) {
      return row;
    }
    let next = row;
    for (let colIndex = sel.startCol; colIndex <= sel.endCol; colIndex += 1) {
      next = writeCell(next, colIndex, "");
    }
    return next;
  });
};

/**
 * "Set all" for one column: write the same value into every row, or only rows in `rowRange`.
 * @param drafts - Current grid rows.
 * @param field - Column to fill.
 * @param value - Comma-joined names or hours text.
 * @param rowRange - Optional inclusive row range (e.g. the current grid selection).
 * @returns Updated rows.
 */
export const setBulkEditColumn = (
  drafts: BulkEditDraftRow[],
  field: BulkEditField,
  value: string,
  rowRange?: { startRow: number; endRow: number } | null,
): BulkEditDraftRow[] => {
  const colIndex = bulkEditColumns.findIndex((column) => column.field === field);
  const startRow = rowRange ? Math.min(rowRange.startRow, rowRange.endRow) : 0;
  const endRow = rowRange ? Math.max(rowRange.startRow, rowRange.endRow) : drafts.length - 1;
  return drafts.map((row, rowIndex) =>
    rowIndex < startRow || rowIndex > endRow ? row : writeCell(row, colIndex, value),
  );
};

/**
 * Turn grid edits into store patches. Only cells whose text changed since the editor opened are
 * resolved, so names already on a task that are not on the roster survive untouched cells.
 * Unknown names, unknown statuses and invalid hours in edited cells are skipped and reported.
 * Adding iOS names or hours turns Needs iOS on.
 * @param drafts - Current grid rows.
 * @param originals - Grid rows captured when the editor opened.
 * @param tasks - Live planner tasks (missing ids are skipped).
 * @param resources - Squad roster.
 * @returns Patches for changed tasks only, plus warnings for the banner.
 */
export const buildBulkEditPatches = (
  drafts: readonly BulkEditDraftRow[],
  originals: readonly BulkEditDraftRow[],
  tasks: readonly Task[],
  resources: Resource[],
): BulkEditPatchResult => {
  const originalsById = new Map(originals.map((row) => [row.taskId, row]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const resourceSets = buildResourceSets(resources);
  const patches: BulkEditPatchResult["patches"] = [];
  const warnings: string[] = [];
  const warningCells = new Set<string>();

  for (const draft of drafts) {
    const original = originalsById.get(draft.taskId);
    const task = tasksById.get(draft.taskId);
    if (!original || !task) continue;

    const patch: Partial<Task> = {};
    for (const column of bulkEditColumns) {
      const raw = draft[column.field];
      if (isBulkEditCellLocked(draft, column.field) || raw.trim() === original[column.field].trim()) continue;
      const cellKey = `${draft.taskId}:${column.field}`;

      if (column.kind === "status") {
        const status = resolveBulkEditStatus(raw);
        if (!status) {
          warningCells.add(cellKey);
          warnings.push(`${storyLabel(task)}: Unknown status "${raw.trim()}"`);
        } else if (status !== task.status) {
          patch.status = status;
        }
        continue;
      }

      if (column.kind === "hours") {
        if (!isValidHoursText(raw)) {
          warningCells.add(cellKey);
          warnings.push(`${storyLabel(task)}: Invalid ${column.label} value "${raw.trim()}"`);
          continue;
        }
        const hours = parseEstimationHours(raw);
        if (hours !== (task[column.field] ?? 0)) {
          patch[column.field] = hours;
        }
        continue;
      }

      const resolved = resolveAssignees(
        raw,
        column.resourceType,
        column.label,
        resourceSets.get(column.resourceType) ?? new Set<string>(),
      );
      if (resolved.warnings.length > 0) {
        warningCells.add(cellKey);
        warnings.push(...resolved.warnings.map((warning) => `${storyLabel(task)}: ${warning}`));
      }
      if (!sameNames(resolved.names, task[column.field] ?? [])) {
        patch[column.field] = resolved.names;
      }
    }

    if (((patch.iosDevs?.length ?? 0) > 0 || (patch.iosHours ?? 0) > 0) && !task.needsIos) {
      patch.needsIos = true;
    }
    if (Object.keys(patch).length > 0) {
      patches.push({ id: task.id, patch });
    }
  }

  return { patches, warnings, warningCells };
};

/**
 * Whether a new story still needs people: no BE or FE developer, or no QC.
 * Standalone items (bugs, tasks, technical tasks) never trigger the editor on their own.
 * @param task - Planner task.
 */
export const hasMissingAssignees = (task: Task): boolean => {
  if (isStandaloneIssueType(task.issueType)) return false;
  const hasDeveloper = task.beDevs.length > 0 || task.feDevs.length > 0;
  return !hasDeveloper || task.qcs.length === 0;
};

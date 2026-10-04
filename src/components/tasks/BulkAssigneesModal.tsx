"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BulkAssigneeSelect } from "@/components/tasks/BulkAssigneeSelect";
import {
  applyBulkEditPaste,
  buildBulkEditDraftRows,
  buildBulkEditPatches,
  bulkEditColumns,
  clearBulkEditSelection,
  isBulkEditCellLocked,
  setBulkEditColumn,
  type BulkEditColumn,
  type BulkEditDraftRow,
  type BulkEditField,
} from "@/lib/planner/bulkAssignees";
import {
  bulkGridSelectionSize,
  isBulkGridCellSelected,
  normalizeBulkGridSelection,
  parseClipboardTable,
  readClipboardPayload,
  type BulkGridSelection,
} from "@/lib/planner/bulkTaskPaste";
import { parseJiraIssueKey } from "@/lib/integrations/jira/issueKey";
import { DEFAULT_JIRA_STORY_STATUSES, statusChipClass } from "@/lib/scheduler/taskStatus";
import type { Resource, ResourceType, Task } from "@/lib/scheduler/types";

export type BulkAssigneesReason = "manual" | "added" | "jira";

interface BulkAssigneesModalProps {
  tasks: Task[];
  resources: Resource[];
  reason: BulkAssigneesReason;
  /** Buffer hours follow the dashboard rule (sprint-lifecycle managers only). */
  canEditBuffer: boolean;
  onSave: (patches: Array<{ id: string; patch: Partial<Task> }>) => void;
  onClose: () => void;
}

const emptySetAllValues = (): Record<BulkEditField, string> =>
  Object.fromEntries(bulkEditColumns.map((column) => [column.field, ""])) as Record<BulkEditField, string>;

const sanitizeHoursInput = (raw: string): string => raw.replace(/[^\d.,]/g, "").slice(0, 5);

const introText = (reason: BulkAssigneesReason, count: number): string => {
  const stories = `${count} ${count === 1 ? "story" : "stories"}`;
  if (reason === "jira") {
    return `${stories} ${count === 1 ? "was" : "were"} added from Jira. Fill in the missing people and hours now, or close and do it later.`;
  }
  if (reason === "added") {
    return `${stories} ${count === 1 ? "was" : "were"} just added. Fill in the missing people and hours now, or close and do it later.`;
  }
  return `Editing status, assignees and hours for ${stories}.`;
};

const COLUMN_CLASS: Record<BulkEditColumn["kind"], string> = {
  status: "bulk-edit-col-status",
  people: "bulk-edit-col-people",
  hours: "bulk-edit-col-hours",
};

const columnClass = (column: BulkEditColumn): string => COLUMN_CLASS[column.kind];

/** Planner statuses, plus the cell's current value when it is a Jira-only status (e.g. Ready for Development). */
const statusOptionsFor = (current: string): readonly string[] =>
  !current || DEFAULT_JIRA_STORY_STATUSES.includes(current) ? DEFAULT_JIRA_STORY_STATUSES : [current, ...DEFAULT_JIRA_STORY_STATUSES];

const lockedCellHint = (row: BulkEditDraftRow, field: BulkEditField): string | undefined => {
  if (!isBulkEditCellLocked(row, field)) return undefined;
  if (field === "bufferHours") return "Only sprint managers can change buffer hours";
  return "Technical Tasks have no BE slot — Dev is the Jira assignee and Dev hours go in FE h";
};

/**
 * Spreadsheet-style editor for status, people and hours (BE / FE / Android / iOS / QC / PM + buffer) on many
 * stories at once. Supports typing, roster dropdowns, drag-select, Excel/Sheets/Slack paste (one
 * value fills a selected range), Delete to clear a range (status is never cleared), and a per-column "Set all" row.
 * Status changes stay in the planner; Jira-linked stories then show Needs push.
 * The Story column stays fixed while scrolling right.
 * Side effects: none until Save, which hands the changed-row patches to `onSave`.
 */
export function BulkAssigneesModal({
  tasks,
  resources,
  reason,
  canEditBuffer,
  onSave,
  onClose,
}: BulkAssigneesModalProps) {
  const [originals] = useState<BulkEditDraftRow[]>(() => buildBulkEditDraftRows(tasks, { canEditBuffer }));
  const [drafts, setDrafts] = useState<BulkEditDraftRow[]>(originals);
  const [selection, setSelection] = useState<BulkGridSelection | null>(null);
  const [setAllValues, setSetAllValues] = useState<Record<BulkEditField, string>>(emptySetAllValues);
  const focusedCellRef = useRef<{ rowIndex: number; colIndex: number }>({ rowIndex: 0, colIndex: 0 });
  const isDraggingRef = useRef(false);

  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const originalsById = useMemo(() => new Map(originals.map((row) => [row.taskId, row])), [originals]);
  const liveDrafts = useMemo(() => drafts.filter((row) => tasksById.has(row.taskId)), [drafts, tasksById]);

  const resourcesByType = useMemo(() => {
    const map: Record<ResourceType, Resource[]> = { FE: [], BE: [], MO: [], QC: [], PM: [], OtherSquad: [] };
    for (const resource of resources) {
      map[resource.type]?.push(resource);
    }
    return map;
  }, [resources]);

  const { patches, warnings, warningCells } = useMemo(
    () => buildBulkEditPatches(liveDrafts, originals, tasks, resources),
    [liveDrafts, originals, tasks, resources],
  );

  const multiCellSelection = selection && bulkGridSelectionSize(selection) > 1 ? selection : null;

  useEffect(() => {
    const stopDrag = () => {
      isDraggingRef.current = false;
    };
    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, []);

  /** Grid edits always run on rows whose story still exists, so removed stories drop out. */
  const updateLiveDrafts = useCallback(
    (update: (rows: BulkEditDraftRow[]) => BulkEditDraftRow[]) => {
      setDrafts((current) => update(current.filter((row) => tasksById.has(row.taskId))));
    },
    [tasksById],
  );

  const updateCell = (rowIndex: number, field: BulkEditField, value: string) => {
    updateLiveDrafts((rows) => rows.map((row, index) => (index === rowIndex ? { ...row, [field]: value } : row)));
  };

  const handleCellMouseDown = (rowIndex: number, colIndex: number, shiftKey: boolean) => {
    focusedCellRef.current = { rowIndex, colIndex };
    if (shiftKey && selection) {
      setSelection({ ...selection, endRow: rowIndex, endCol: colIndex });
      return;
    }
    setSelection({ startRow: rowIndex, startCol: colIndex, endRow: rowIndex, endCol: colIndex });
    isDraggingRef.current = true;
  };

  const handleCellMouseEnter = (rowIndex: number, colIndex: number) => {
    if (!isDraggingRef.current || !selection) return;
    setSelection({ ...selection, endRow: rowIndex, endCol: colIndex });
  };

  const handlePasteCapture = (event: React.ClipboardEvent) => {
    const { html, plain, rtf, slackTexty } = readClipboardPayload(event.clipboardData);
    const table = parseClipboardTable(html, plain, rtf, slackTexty);
    const isTable = table.length > 1 || table.some((row) => row.length > 1);
    if (table.length === 0 || (!isTable && !multiCellSelection)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const anchor = focusedCellRef.current;
    updateLiveDrafts((rows) => applyBulkEditPaste(rows, table, anchor, multiCellSelection));
  };

  const handleGridKeyDown = (event: React.KeyboardEvent) => {
    if ((event.key !== "Backspace" && event.key !== "Delete") || !multiCellSelection) {
      return;
    }
    event.preventDefault();
    updateLiveDrafts((rows) => clearBulkEditSelection(rows, multiCellSelection));
  };

  const applySetAll = (field: BulkEditField) => {
    const rowRange = multiCellSelection ? normalizeBulkGridSelection(multiCellSelection) : null;
    updateLiveDrafts((rows) => setBulkEditColumn(rows, field, setAllValues[field], rowRange));
  };

  const changedCount = patches.length;
  const setAllScope = multiCellSelection ? "the selected rows" : "every row";

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(8vh,4rem)]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex w-full max-w-[min(95vw,72rem)] flex-col rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-assignees-title"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 id="bulk-assignees-title" className="text-lg font-semibold text-slate-900">
            Bulk edit details
          </h3>
          <p className="mt-1 text-sm text-slate-600">{introText(reason, liveDrafts.length)}</p>
          <p className="mt-1 text-[12px] text-slate-500">
            Pick a status, type names separated by commas or pick from ▾, and type hours in the “h” columns. Drag to
            select cells and paste from Excel, Sheets or Slack — one copied value fills every selected cell. Delete
            clears the selection. Use the “Set all” row to fill a whole column (or only the selected rows). Status
            changes stay in the planner — push the stories to send them to Jira.
          </p>
          {warnings.length > 0 ? (
            <p className="mt-2 text-sm font-medium text-amber-800" title={warnings.join("\n")}>
              {warningCells.size} {warningCells.size === 1 ? "cell has" : "cells have"} unknown names, statuses or
              invalid hours — those cells will be skipped.
            </p>
          ) : null}
        </div>

        <div className="overflow-auto px-5 py-4" onPasteCapture={handlePasteCapture} onKeyDownCapture={handleGridKeyDown}>
          <table className="bulk-add-grid bulk-edit-grid select-none border-collapse text-sm">
            <thead>
              <tr>
                <th className="bulk-edit-col-index border border-slate-300 bg-slate-100 px-1 py-1.5 text-center text-xs font-semibold text-slate-500">
                  #
                </th>
                <th className="bulk-edit-col-story border border-slate-300 bg-slate-100 px-1.5 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Story
                </th>
                {bulkEditColumns.map((column) => (
                  <th
                    key={column.field}
                    className={`${columnClass(column)} border border-slate-300 bg-slate-100 px-1 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="bulk-edit-col-index border border-slate-300 bg-blue-50 px-1 py-1" />
                <th className="bulk-edit-col-story border border-slate-300 bg-blue-50 px-1.5 py-1 text-left text-[11px] font-semibold text-blue-900">
                  Set all{multiCellSelection ? " (selected rows)" : ""}
                </th>
                {bulkEditColumns.map((column) => {
                  const options = column.kind === "people" ? resourcesByType[column.resourceType] ?? [] : [];
                  const disabled =
                    column.kind === "people" ? options.length === 0 : column.field === "bufferHours" && !canEditBuffer;
                  const fillDisabled = disabled || (column.kind === "status" && !setAllValues.status);
                  return (
                    <th
                      key={column.field}
                      className={`${columnClass(column)} border border-slate-300 bg-blue-50 p-0 align-top font-normal`}
                    >
                      <div className="flex min-w-0 items-stretch">
                        <div className="min-w-0 flex-1">
                          {column.kind === "status" ? (
                            <select
                              className={`bulk-edit-status-select ${
                                setAllValues.status ? statusChipClass(setAllValues.status) : "bg-transparent text-slate-600"
                              }`}
                              value={setAllValues.status}
                              aria-label={`Status for ${setAllScope}`}
                              onChange={(event) =>
                                setSetAllValues((current) => ({ ...current, status: event.target.value }))
                              }
                            >
                              <option value="">Pick…</option>
                              {DEFAULT_JIRA_STORY_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          ) : column.kind === "people" ? (
                            <BulkAssigneeSelect
                              value={setAllValues[column.field]}
                              options={options}
                              disabled={disabled}
                              onChange={(next) => setSetAllValues((current) => ({ ...current, [column.field]: next }))}
                            />
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              disabled={disabled}
                              className="w-full border-0 bg-transparent px-0.5 py-1.5 text-center text-xs tabular-nums text-slate-900 outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400 disabled:opacity-45"
                              value={setAllValues[column.field]}
                              placeholder="h"
                              aria-label={`${column.label} for ${setAllScope}`}
                              onChange={(event) =>
                                setSetAllValues((current) => ({
                                  ...current,
                                  [column.field]: sanitizeHoursInput(event.target.value),
                                }))
                              }
                            />
                          )}
                        </div>
                        <button
                          type="button"
                          className="shrink-0 border-0 border-l border-slate-200 bg-transparent px-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-40"
                          disabled={fillDisabled}
                          aria-label={`Fill ${column.label} for ${setAllScope}`}
                          title={
                            column.kind === "status"
                              ? `Set this status on ${setAllScope}`
                              : `Fill the ${column.label} column for ${setAllScope} (leave empty to clear it)`
                          }
                          onClick={() => applySetAll(column.field)}
                        >
                          ↓
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {liveDrafts.map((draft, rowIndex) => {
                const task = tasksById.get(draft.taskId);
                if (!task) return null;
                const issueKey = parseJiraIssueKey(task.storyLink);
                const storyName = task.storyName.trim() || task.storyLink.trim() || "Untitled story";
                const original = originalsById.get(draft.taskId);
                return (
                  <tr key={draft.taskId}>
                    <td className="bulk-edit-col-index border border-slate-300 bg-white px-1 py-0 text-center text-xs tabular-nums text-slate-400">
                      {rowIndex + 1}
                    </td>
                    <td className="bulk-edit-col-story border border-slate-300 bg-white px-1.5 py-1">
                      <div className="truncate text-xs font-semibold text-slate-900" title={storyName}>
                        {storyName}
                      </div>
                      {issueKey || task.issueType ? (
                        <div className="truncate text-[10px] text-slate-500">
                          {[issueKey, task.issueType].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                    </td>
                    {bulkEditColumns.map((column, colIndex) => {
                      const { field } = column;
                      const locked = isBulkEditCellLocked(draft, field);
                      const selected = isBulkGridCellSelected(rowIndex, colIndex, selection);
                      const edited = draft[field].trim() !== (original?.[field] ?? "").trim();
                      const hasWarning = warningCells.has(`${draft.taskId}:${field}`);
                      const onFocusCell = () => {
                        focusedCellRef.current = { rowIndex, colIndex };
                      };
                      return (
                        <td
                          key={field}
                          className={`${columnClass(column)} border border-slate-300 p-0 ${
                            selected
                              ? "bg-blue-100/80"
                              : hasWarning
                                ? "bg-amber-50"
                                : edited
                                  ? "bg-emerald-50/70"
                                  : locked
                                    ? "bg-slate-50"
                                    : ""
                          }`}
                          title={lockedCellHint(draft, field)}
                          onMouseEnter={() => handleCellMouseEnter(rowIndex, colIndex)}
                          onMouseDown={(event) => {
                            if (event.button !== 0) return;
                            handleCellMouseDown(rowIndex, colIndex, event.shiftKey);
                          }}
                        >
                          {column.kind === "status" ? (
                            <select
                              className={`bulk-edit-status-select ${statusChipClass(draft.status)} ${
                                selected
                                  ? "ring-2 ring-inset ring-blue-500"
                                  : hasWarning
                                    ? "ring-2 ring-inset ring-amber-500"
                                    : edited
                                      ? "ring-2 ring-inset ring-emerald-500"
                                      : ""
                              }`}
                              value={draft.status}
                              title={draft.status}
                              aria-label={`Status for ${storyName}`}
                              onFocus={onFocusCell}
                              onChange={(event) => updateCell(rowIndex, field, event.target.value)}
                            >
                              {statusOptionsFor(draft.status).map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          ) : column.kind === "people" ? (
                            <BulkAssigneeSelect
                              value={locked ? "" : draft[field]}
                              options={resourcesByType[column.resourceType] ?? []}
                              disabled={locked || (resourcesByType[column.resourceType] ?? []).length === 0}
                              onFocusCell={onFocusCell}
                              onChange={(next) => updateCell(rowIndex, field, next)}
                            />
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              disabled={locked}
                              className="w-full border-0 bg-transparent px-0.5 py-1.5 text-center text-xs tabular-nums text-slate-900 outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400 disabled:opacity-45"
                              value={locked ? "" : draft[field]}
                              placeholder="0"
                              aria-label={`${column.label} for ${storyName}`}
                              onFocus={onFocusCell}
                              onChange={(event) => updateCell(rowIndex, field, sanitizeHoursInput(event.target.value))}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
          <span className="text-[12px] text-slate-500">
            {changedCount > 0
              ? `${changedCount} ${changedCount === 1 ? "story" : "stories"} will be updated.`
              : "No changes yet."}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              title="Close without changing any status, assignees or hours"
              onClick={onClose}
            >
              {reason === "manual" ? "Cancel" : "Later"}
            </button>
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={changedCount === 0}
              title={changedCount === 0 ? "Change at least one cell first" : "Save the new status, assignees and hours to these stories"}
              onClick={() => onSave(patches)}
            >
              Save {changedCount > 0 ? changedCount : ""} {changedCount === 1 ? "story" : "stories"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

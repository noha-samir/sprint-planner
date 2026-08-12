"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyClipboardPasteToDrafts,
  bulkDraftFieldAt,
  bulkGridSelectionSize,
  clearBulkGridSelection,
  countClipboardRowsMissingLinks,
  createEmptyBulkDraftRows,
  isBulkGridCellSelected,
  parseClipboardTable,
  readClipboardPayload,
  resolveBulkTaskRow,
  shouldInterceptBulkGridPaste,
  type BulkGridSelection,
  type BulkTaskDraftRow,
} from "@/lib/planner/bulkTaskPaste";
import { resourceDisplayName } from "@/lib/planner/resourceIdentity";
import type { Resource, ResourceType } from "@/lib/scheduler/types";

const DEFAULT_ROW_COUNT = 5;

interface BulkAddTasksModalProps {
  resources: Resource[];
  onConfirm: (rows: ReturnType<typeof resolveBulkTaskRow>[]) => void;
  onCancel: () => void;
}

type DraftField = keyof BulkTaskDraftRow;

type ColumnDef =
  | { key: DraftField; label: string; kind: "text"; placeholder: string; colClass: string }
  | { key: DraftField; label: string; kind: "assignees"; resourceType: ResourceType; colClass: string }
  | { key: DraftField; label: string; kind: "mobileApp"; colClass: string }
  | { key: DraftField; label: string; kind: "hours"; placeholder: string; colClass: string };

const columns: ColumnDef[] = [
  { key: "storyName", label: "Story", kind: "text", placeholder: "Story name", colClass: "bulk-col-story" },
  { key: "storyLink", label: "Link", kind: "text", placeholder: "https://…", colClass: "bulk-col-link" },
  { key: "beDevsRaw", label: "BE", kind: "assignees", resourceType: "BE", colClass: "bulk-col-dev" },
  { key: "beHoursRaw", label: "BE h", kind: "hours", placeholder: "8", colClass: "bulk-col-hours" },
  { key: "feDevsRaw", label: "FE", kind: "assignees", resourceType: "FE", colClass: "bulk-col-dev" },
  { key: "feHoursRaw", label: "FE h", kind: "hours", placeholder: "4", colClass: "bulk-col-hours" },
  { key: "androidDevsRaw", label: "Android", kind: "assignees", resourceType: "MO", colClass: "bulk-col-dev" },
  { key: "androidHoursRaw", label: "And h", kind: "hours", placeholder: "6", colClass: "bulk-col-hours" },
  { key: "mobileAppRaw", label: "App", kind: "mobileApp", colClass: "bulk-col-app" },
  { key: "iosDevsRaw", label: "IOS", kind: "assignees", resourceType: "MO", colClass: "bulk-col-dev" },
  { key: "iosHoursRaw", label: "IOS h", kind: "hours", placeholder: "6", colClass: "bulk-col-hours" },
  { key: "qcsRaw", label: "QC", kind: "assignees", resourceType: "QC", colClass: "bulk-col-dev" },
  { key: "productManagersRaw", label: "PM", kind: "assignees", resourceType: "PM", colClass: "bulk-col-dev" },
  { key: "qcHoursRaw", label: "QC h", kind: "hours", placeholder: "2", colClass: "bulk-col-hours" },
];

const splitNames = (raw: string): string[] =>
  raw
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const joinNames = (names: string[]): string => names.join(", ");

function BulkAssigneeSelect({
  value,
  options,
  disabled,
  onChange,
  onFocusCell,
}: {
  value: string;
  options: Resource[];
  disabled?: boolean;
  onChange: (next: string) => void;
  onFocusCell?: () => void;
}) {
  const selected = useMemo(() => new Set(splitNames(value)), [value]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div className="bulk-assignee-dropdown relative flex min-w-0 items-stretch" ref={rootRef}>
      <input
        type="text"
        disabled={disabled}
        className="bulk-assignee-input min-w-0 flex-1 border-0 bg-transparent px-1.5 py-1.5 text-xs text-slate-900 outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400 disabled:opacity-45"
        value={value}
        placeholder="Paste or type…"
        title={value || "Paste names or pick from dropdown"}
        onFocus={() => onFocusCell?.()}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        disabled={disabled}
        className="bulk-assignee-menu-btn shrink-0 border-0 border-l border-slate-200 bg-transparent px-1.5 text-xs text-slate-500 outline-none hover:bg-slate-50 disabled:opacity-45"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Choose assignees"
        onClick={() => {
          if (disabled) return;
          onFocusCell?.();
          setOpen((current) => !current);
        }}
      >
        ▾
      </button>
      {open && !disabled ? (
        <div className="bulk-assignee-menu" role="listbox" aria-multiselectable="true">
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-slate-500">No people</div>
          ) : (
            options.map((option) => {
              const checked = selected.has(option.name);
              return (
                <label key={option.name} className="bulk-assignee-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(option.name)) next.delete(option.name);
                      else next.add(option.name);
                      onChange(joinNames([...next]));
                    }}
                  />
                  <span className="min-w-0 truncate">{resourceDisplayName(option)}</span>
                </label>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export function BulkAddTasksModal({ resources, onConfirm, onCancel }: BulkAddTasksModalProps) {
  const [draftRows, setDraftRows] = useState<BulkTaskDraftRow[]>(() => createEmptyBulkDraftRows(DEFAULT_ROW_COUNT));
  const [selection, setSelection] = useState<BulkGridSelection | null>(null);
  const [pasteMissingLinks, setPasteMissingLinks] = useState(0);
  const focusedCellRef = useRef<{ rowIndex: number; colIndex: number }>({ rowIndex: 0, colIndex: 0 });
  const isDraggingRef = useRef(false);

  const resourcesByType = useMemo(() => {
    const map: Record<ResourceType, Resource[]> = {
      FE: [],
      BE: [],
      MO: [],
      QC: [],
      PM: [],
      OtherSquad: [],
    };
    for (const resource of resources) {
      map[resource.type]?.push(resource);
    }
    return map;
  }, [resources]);

  const resolvedRows = useMemo(
    () => draftRows.map((draft) => resolveBulkTaskRow(draft, resources)),
    [draftRows, resources],
  );

  const validRows = useMemo(() => resolvedRows.filter((row) => row.isValid), [resolvedRows]);
  const warningCount = useMemo(
    () => resolvedRows.filter((row) => row.isValid && row.warnings.length > 0).length,
    [resolvedRows],
  );

  useEffect(() => {
    const stopDrag = () => {
      isDraggingRef.current = false;
    };
    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, []);

  const updateCell = useCallback((rowIndex: number, field: DraftField, value: string) => {
    setDraftRows((current) =>
      current.map((row, index) => (index === rowIndex ? { ...row, [field]: value } : row)),
    );
  }, []);

  const addRows = useCallback((count = 1) => {
    setDraftRows((current) => [...current, ...createEmptyBulkDraftRows(count)]);
  }, []);

  const removeRow = useCallback((rowIndex: number) => {
    setDraftRows((current) => {
      if (current.length <= 1) {
        return createEmptyBulkDraftRows(1);
      }
      return current.filter((_, index) => index !== rowIndex);
    });
    setSelection(null);
  }, []);

  const handleCellMouseDown = useCallback(
    (rowIndex: number, colIndex: number, shiftKey: boolean) => {
      focusedCellRef.current = { rowIndex, colIndex };

      if (shiftKey && selection) {
        setSelection({
          startRow: selection.startRow,
          startCol: selection.startCol,
          endRow: rowIndex,
          endCol: colIndex,
        });
        return;
      }

      setSelection({
        startRow: rowIndex,
        startCol: colIndex,
        endRow: rowIndex,
        endCol: colIndex,
      });
      isDraggingRef.current = true;
    },
    [selection],
  );

  const handleCellMouseEnter = useCallback((rowIndex: number, colIndex: number) => {
    if (!isDraggingRef.current || !selection) {
      return;
    }

    setSelection({
      startRow: selection.startRow,
      startCol: selection.startCol,
      endRow: rowIndex,
      endCol: colIndex,
    });
  }, [selection]);

  const applyPaste = useCallback(
    (html: string, plain: string, rtf: string, slackTexty: string, anchorRow: number, anchorCol: number) => {
      const table = parseClipboardTable(html, plain, rtf, slackTexty);
      if (table.length === 0) {
        return false;
      }

      setPasteMissingLinks(countClipboardRowsMissingLinks(table));
      setDraftRows((current) =>
        applyClipboardPasteToDrafts(
          current,
          table,
          { rowIndex: anchorRow, colIndex: anchorCol },
          selection,
        ),
      );
      return true;
    },
    [selection],
  );

  const handlePasteCapture = useCallback(
    (event: React.ClipboardEvent) => {
      const { html, plain, rtf, slackTexty } = readClipboardPayload(event.clipboardData);
      const table = parseClipboardTable(html, plain, rtf, slackTexty);
      if (table.length === 0) {
        return;
      }

      const selectionSize = selection ? bulkGridSelectionSize(selection) : 0;
      const focusedField = bulkDraftFieldAt(focusedCellRef.current.colIndex);
      if (!shouldInterceptBulkGridPaste(html, plain, table, selectionSize, rtf, focusedField)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const anchor = focusedCellRef.current;
      applyPaste(html, plain, rtf, slackTexty, anchor.rowIndex, anchor.colIndex);
    },
    [applyPaste, selection],
  );

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") {
        return;
      }
      if (!selection || bulkGridSelectionSize(selection) <= 1) {
        return;
      }

      event.preventDefault();
      setDraftRows((current) => clearBulkGridSelection(current, selection));
    },
    [selection],
  );

  const handleCreate = () => {
    if (validRows.length === 0) {
      return;
    }
    onConfirm(validRows);
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(8vh,4rem)]"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="flex w-full max-w-[95vw] flex-col rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-add-tasks-title"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 id="bulk-add-tasks-title" className="text-lg font-semibold text-slate-900">
            Bulk add tasks
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Paste into Story, Link, or any Dev cell (Excel / Sheets / Slack). Android and IOS are separate — filling
            IOS names or hours turns Needs iOS on automatically. Mobile start defaults to the squad sprint start;
            set a custom start later from the dashboard if needed. Slack links copy as{" "}
            <code className="rounded bg-slate-100 px-1">&lt;url|title&gt;</code>.
          </p>
          {pasteMissingLinks > 0 ? (
            <p className="mt-2 text-sm font-medium text-amber-800">
              {pasteMissingLinks} {pasteMissingLinks === 1 ? "story has" : "stories have"} no link. In Slack, select
              the blue linked text (not plain titles), copy, then paste again into the Story column.
            </p>
          ) : null}
          {warningCount > 0 ? (
            <p className="mt-2 text-sm font-medium text-amber-800">
              {warningCount} {warningCount === 1 ? "row has" : "rows have"} unknown assignee names — those cells will be
              skipped.
            </p>
          ) : null}
        </div>

        <div className="overflow-auto px-5 py-4" onPasteCapture={handlePasteCapture} onKeyDownCapture={handleGridKeyDown}>
          <table className="bulk-add-grid w-full min-w-[64rem] border-collapse text-sm select-none">
            <thead>
              <tr className="bg-slate-100">
                <th className="w-8 border border-slate-300 px-1 py-1.5 text-center text-xs font-semibold text-slate-500">
                  #
                </th>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`border border-slate-300 px-1.5 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${column.colClass}`}
                  >
                    {column.label}
                  </th>
                ))}
                <th className="w-8 border border-slate-300 px-1 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {draftRows.map((draft, rowIndex) => {
                const resolved = resolvedRows[rowIndex];
                const hasWarning = resolved.isValid && resolved.warnings.length > 0;
                return (
                  <tr key={rowIndex} className={hasWarning ? "bg-amber-50/60" : "bg-white"}>
                    <td className="border border-slate-300 px-1 py-0 text-center text-xs tabular-nums text-slate-400">
                      {rowIndex + 1}
                    </td>
                    {columns.map((column, colIndex) => {
                      const selected = isBulkGridCellSelected(rowIndex, colIndex, selection);
                      const cellClass = `border border-slate-300 p-0 ${column.colClass} ${selected ? "bg-blue-100/80" : ""}`;
                      return (
                        <td
                          key={column.key}
                          className={cellClass}
                          onMouseEnter={() => handleCellMouseEnter(rowIndex, colIndex)}
                          onMouseDown={(event) => {
                            if (event.button !== 0) return;
                            handleCellMouseDown(rowIndex, colIndex, event.shiftKey);
                          }}
                        >
                          {column.kind === "assignees" ? (
                            <BulkAssigneeSelect
                              value={draft[column.key]}
                              options={resourcesByType[column.resourceType] ?? []}
                              disabled={(resourcesByType[column.resourceType] ?? []).length === 0}
                              onFocusCell={() => {
                                focusedCellRef.current = { rowIndex, colIndex };
                              }}
                              onChange={(next) => updateCell(rowIndex, column.key, next)}
                            />
                          ) : column.kind === "mobileApp" ? (
                            <select
                              className="w-full border-0 bg-transparent px-1 py-1.5 text-xs outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400"
                              value={normalizeAppDraft(draft.mobileAppRaw)}
                              onFocus={() => {
                                focusedCellRef.current = { rowIndex, colIndex };
                              }}
                              onChange={(event) => updateCell(rowIndex, "mobileAppRaw", event.target.value)}
                            >
                              <option value="">None</option>
                              <option value="star">Star</option>
                              <option value="hubs">Hubs</option>
                            </select>
                          ) : column.kind === "hours" ? (
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={2}
                              className={`bulk-hours-input w-full border-0 bg-transparent px-0.5 py-1.5 text-center text-sm tabular-nums text-slate-900 outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400 ${
                                selected ? "bg-blue-100/80" : "focus:bg-blue-50/80"
                              }`}
                              value={draft[column.key]}
                              placeholder={column.placeholder}
                              title={draft[column.key] || column.placeholder}
                              onFocus={() => {
                                focusedCellRef.current = { rowIndex, colIndex };
                              }}
                              onChange={(event) => {
                                const next = event.target.value.replace(/\D/g, "").slice(0, 2);
                                updateCell(rowIndex, column.key, next);
                              }}
                            />
                          ) : (
                            <input
                              type="text"
                              className={`w-full border-0 bg-transparent px-1.5 py-1.5 text-sm text-slate-900 outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400 ${
                                column.key === "storyLink" ? "bulk-link-input truncate text-xs" : ""
                              } ${column.key === "storyName" ? "bulk-story-input" : ""} ${
                                selected ? "bg-blue-100/80" : "focus:bg-blue-50/80"
                              }`}
                              value={draft[column.key]}
                              placeholder={column.placeholder}
                              title={
                                column.key === "storyLink" || column.key === "storyName"
                                  ? draft[column.key]
                                  : undefined
                              }
                              onFocus={() => {
                                focusedCellRef.current = { rowIndex, colIndex };
                              }}
                              onChange={(event) => updateCell(rowIndex, column.key, event.target.value)}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="border border-slate-300 px-1 py-0 text-center">
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-red-50 hover:text-red-700"
                        aria-label={`Remove row ${rowIndex + 1}`}
                        onClick={() => removeRow(rowIndex)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => addRows(5)}>
            + Add 5 rows
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={validRows.length === 0}
              onClick={handleCreate}
            >
              Create {validRows.length > 0 ? validRows.length : ""} {validRows.length === 1 ? "task" : "tasks"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const normalizeAppDraft = (raw: string): string => {
  const value = raw.trim().toLowerCase();
  if (value === "star" || value === "star app") return "star";
  if (value === "hubs" || value === "hubs app" || value === "hub") return "hubs";
  return "";
};

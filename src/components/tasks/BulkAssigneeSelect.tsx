"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resourceDisplayName } from "@/lib/planner/resourceIdentity";
import type { Resource } from "@/lib/scheduler/types";

const splitNames = (raw: string): string[] =>
  raw
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const joinNames = (names: string[]): string => names.join(", ");

/**
 * Spreadsheet assignee cell: free text (comma-separated names) plus a roster checklist dropdown.
 * Shared by Bulk insertion and the bulk assignee editor.
 * @param value - Comma-joined names.
 * @param options - Roster people allowed in this column.
 * @param disabled - Read-only cell.
 * @param onChange - Receives the new comma-joined names.
 * @param onFocusCell - Called when the cell takes focus (grid anchor tracking).
 */
export function BulkAssigneeSelect({
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
        title="Pick assignees from the roster"
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

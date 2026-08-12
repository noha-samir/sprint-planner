"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResourceType } from "@/lib/scheduler/types";

type JiraUserCandidate = { accountId: string; displayName: string };

type Props = {
  open: boolean;
  teamType: ResourceType | null;
  squadHeaders: Record<string, string>;
  capacityHours: number;
  onClose: () => void;
  onCreated: (
    resource: {
      name: string;
      type: ResourceType;
      ownershipMode: "shared";
      ourSquadHours: number;
      capacityHours: number;
    },
    assigneeMap?: Record<string, string>,
  ) => void;
};

const teamLabel = (type: ResourceType | null): string => {
  if (type === "BE") return "Backend team";
  if (type === "FE") return "Frontend team";
  if (type === "MO") return "Mobile team";
  if (type === "QC") return "QC team";
  if (type === "PM") return "Product Manager team";
  if (type === "OtherSquad") return "Other Squad team";
  return "Team";
};

/**
 * Super-admin modal: search Jira users and create a roster person with exact displayName + account map.
 */
export function AddJiraPersonModal({
  open,
  teamType,
  squadHeaders,
  capacityHours,
  onClose,
  onCreated,
}: Props) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<JiraUserCandidate[]>([]);
  const [pickedId, setPickedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setUsers([]);
    setPickedId("");
    setError(null);
    setBusy(false);
    setSaving(false);
  }, [open, teamType]);

  const picked = useMemo(
    () => users.find((user) => user.accountId === pickedId) ?? null,
    [users, pickedId],
  );

  const search = async () => {
    const q = query.trim();
    if (!q) {
      setError("Enter a name to search Jira.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/integrations/jira/assignees/search?q=${encodeURIComponent(q)}`,
        { cache: "no-store", headers: squadHeaders },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "Jira search failed");
        return;
      }
      const body = (await response.json()) as { users: JiraUserCandidate[] };
      setUsers(body.users);
      setPickedId(body.users.length === 1 ? body.users[0].accountId : "");
      if (body.users.length === 0) {
        setError(`No Jira accounts found for "${q}".`);
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!teamType || !picked) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/jira/assignees/create-resource", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...squadHeaders },
        body: JSON.stringify({
          type: teamType,
          accountId: picked.accountId,
          displayName: picked.displayName,
          capacityHours,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "Failed to add person");
        return;
      }
      const body = (await response.json()) as {
        resource: {
          name: string;
          type: ResourceType;
          ownershipMode: "shared";
          ourSquadHours: number;
          capacityHours: number;
        };
        config?: { assigneeMap?: Record<string, string> };
      };
      onCreated(body.resource, body.config?.assigneeMap);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open || !teamType) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-jira-person-title"
      >
        <h3 id="add-jira-person-title" className="text-base font-semibold text-slate-900">
          Add {teamLabel(teamType)} from Jira
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          Search and pick the exact Jira account. The roster name will be their Jira display name.
        </p>

        <div className="mt-3 flex gap-2">
          <input
            className="field-input min-w-0 flex-1"
            placeholder="Search Jira display name…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="btn-primary shrink-0 px-3 py-1.5 text-[13px] disabled:opacity-60"
            disabled={busy}
            onClick={() => void search()}
          >
            {busy ? "Finding…" : "Find"}
          </button>
        </div>

        {users.length > 0 ? (
          <label className="mt-3 block text-sm">
            <span className="font-medium text-slate-800">Pick account</span>
            <select
              className="field-input mt-1 w-full"
              value={pickedId}
              onChange={(event) => setPickedId(event.target.value)}
            >
              <option value="">Select…</option>
              {users.map((user) => (
                <option key={user.accountId} value={user.accountId}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {error ? (
          <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-800">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-[13px]" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary px-3 py-1.5 text-[13px] disabled:opacity-60"
            disabled={!picked || saving}
            onClick={() => void confirm()}
          >
            {saving ? "Adding…" : "Add person"}
          </button>
        </div>
      </div>
    </div>
  );
}

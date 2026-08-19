"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultSquadJiraConfig, type SquadJiraConfig } from "@/lib/integrations/jira/types";

interface JiraStatus {
  configured: boolean;
  connected: boolean;
  siteUrl: string | null;
  signedInJiraEmail: string | null;
  displayName: string | null;
}

const parentFieldLabels: Array<{ key: keyof SquadJiraConfig["parentStoryFields"]; label: string; hint: string }> = [
  {
    key: "developmentEstimateHours",
    label: "Development estimate field",
    hint: "Custom field for total FE + BE + Android + IOS hours on the parent story",
  },
  {
    key: "testingEstimateHours",
    label: "Testing estimate field",
    hint: "Custom field for QC hours on the parent story",
  },
  {
    key: "qcEngineer",
    label: "QC Engineer field",
    hint: "Filled from the first QC assignee on the planner row",
  },
  {
    key: "productManager",
    label: "Product Manager field",
    hint: "Filled from the first Product Manager assignee on the planner row",
  },
  {
    key: "branchName",
    label: "Branch name field",
    hint: "Story title + Jira issue number",
  },
];

type Props = {
  squadHeaders: Record<string, string>;
};

/**
 * Super-admin panel: Jira site/project/field settings with a single Save.
 * Designed as a full scrollable page section (not a cramped accordion).
 */
export function JiraConnectionFields({ squadHeaders }: Props) {
  const [status, setStatus] = useState<JiraStatus | null>(null);
  const [config, setConfig] = useState<SquadJiraConfig>(() => defaultSquadJiraConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, configRes] = await Promise.all([
        fetch("/api/integrations/jira/status", { cache: "no-store", headers: squadHeaders }),
        fetch("/api/integrations/jira/config", { cache: "no-store", headers: squadHeaders }),
      ]);
      if (statusRes.ok) {
        setStatus((await statusRes.json()) as JiraStatus);
      }
      if (configRes.ok) {
        setConfig((await configRes.json()) as SquadJiraConfig);
      }
    } finally {
      setLoading(false);
    }
  }, [squadHeaders]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load when squad headers change
    void load();
  }, [load]);

  const headerHint = useMemo(() => {
    if (status?.connected) {
      return `Connected as ${status.signedInJiraEmail ?? status.displayName ?? "Jira"}`;
    }
    if (status?.configured) return "Site saved — sign in with a Jira API key";
    return "Not connected";
  }, [status]);

  const saveConfig = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/jira/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...squadHeaders },
        body: JSON.stringify({
          siteUrl: config.siteUrl,
          projectKey: config.projectKey,
          issueTypeSubTask: config.issueTypeSubTask,
          parentStoryFields: config.parentStoryFields,
          qcEngineerFieldIsUser: config.qcEngineerFieldIsUser,
          productManagerFieldIsUser: config.productManagerFieldIsUser,
          subtaskSquadFieldId: config.subtaskSquadFieldId,
          subtaskSquadOptionId: config.subtaskSquadOptionId,
          engineeringManagerFieldId: config.engineeringManagerFieldId,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setMessage(body.error ?? "Failed to save Jira settings");
        return;
      }
      setConfig((await response.json()) as SquadJiraConfig);
      setMessage("Jira settings saved.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      id="jira-connection"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="shrink-0 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Jira connection & fields</h2>
        <p className="text-[11px] text-slate-500">{headerHint}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:thin]">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 pb-6">
            {message ? (
              <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                {message}
              </p>
            ) : null}

            <div className="space-y-3">
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Jira site URL</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={config.siteUrl}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, siteUrl: event.target.value }))
                  }
                  placeholder="https://your-company.atlassian.net"
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium text-slate-800">Project key</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={config.projectKey}
                    onChange={(event) =>
                      setConfig((current) => ({ ...current, projectKey: event.target.value }))
                    }
                    placeholder="BR"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-800">Sub-task issue type</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={config.issueTypeSubTask}
                    onChange={(event) =>
                      setConfig((current) => ({ ...current, issueTypeSubTask: event.target.value }))
                    }
                    placeholder="Sub-task"
                  />
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Parent story fields</h3>
              {parentFieldLabels.map((field) => (
                <label key={field.key} className="block text-sm">
                  <span className="font-medium text-slate-800">{field.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{field.hint}</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                    value={config.parentStoryFields[field.key]}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        parentStoryFields: {
                          ...current.parentStoryFields,
                          [field.key]: event.target.value,
                        },
                      }))
                    }
                    placeholder="customfield_…"
                  />
                </label>
              ))}
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.qcEngineerFieldIsUser}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        qcEngineerFieldIsUser: event.target.checked,
                      }))
                    }
                  />
                  QC Engineer is a Jira user field
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.productManagerFieldIsUser}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        productManagerFieldIsUser: event.target.checked,
                      }))
                    }
                  />
                  Product Manager is a Jira user field
                </label>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Sub-task Squad field id</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                  value={config.subtaskSquadFieldId}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, subtaskSquadFieldId: event.target.value }))
                  }
                  placeholder="customfield_10001"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Squad option id</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                  value={config.subtaskSquadOptionId}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, subtaskSquadOptionId: event.target.value }))
                  }
                  placeholder="10001"
                />
              </label>
              <label className="block text-sm md:col-span-2">
                <span className="font-medium text-slate-800">Engineering Manager field</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Parent-story user field. Pull from Jira also adds this EM’s current-sprint stories and leftover open stories from closed sprints.
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                  value={config.engineeringManagerFieldId}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, engineeringManagerFieldId: event.target.value }))
                  }
                  placeholder="customfield_10200"
                />
              </label>
            </div>

            <div className="sticky bottom-0 flex justify-end border-t border-slate-100 bg-white pt-3">
              <button
                type="button"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={saving}
                onClick={() => void saveConfig()}
              >
                {saving ? "Saving…" : "Save Jira settings"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

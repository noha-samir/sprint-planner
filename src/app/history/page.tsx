"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useSession } from "next-auth/react";
import { getCapabilities, plannerAccessContext } from "@/lib/access/control";
import { effectiveMobileHours } from "@/lib/scheduler/mobilePlatform";
import { getSprintWindowEnd, parseCalendarDate } from "@/lib/scheduler/calendar";
import { getCurrentStoryPhase, getStatusPhase, type StoryPhase } from "@/lib/scheduler/currentPhase";
import { schedule } from "@/lib/scheduler/engine";
import { thursdayReleaseChipLabel, type Task } from "@/lib/scheduler/types";
import { isExcludedFromSchedule, releaseDateHandoffLabel, statusRowClass } from "@/lib/scheduler/taskStatus";
import { activeSprintTasks } from "@/store/taskRules";
import { usePlannerStore } from "@/store/usePlannerStore";
import type { SprintHistoryEntry, SprintHistoryListItem } from "@/lib/history/types";
import { safeStoryHref } from "@/lib/ui/safeStoryHref";

const fmtDateTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, "EEE dd MMM, yyyy hh:mm a");
};

const fmtDateOnly = (value: Date) => format(value, "EEE dd MMM");
const fmtTimeOnly = (value: Date) => format(value, "hh:mm a");
const developmentHours = (task: Task) =>
  task.beHours + task.feHours + effectiveMobileHours(task) + task.integrationHours;
const totalEffortHours = (task: Task) =>
  task.beHours +
  task.feHours +
  effectiveMobileHours(task) +
  task.integrationHours +
  task.qcHours +
  (task.bufferHours ?? 0);
const canCalculateRelease = (task: Task) =>
  !isExcludedFromSchedule(task.status) &&
  (task.feHours > 0 ||
    task.beHours > 0 ||
    effectiveMobileHours(task) > 0 ||
    task.integrationHours > 0 ||
    task.qcHours > 0 ||
    (task.bufferHours ?? 0) > 0);
const storyHref = safeStoryHref;

export default function HistoryPage() {
  const { data: session } = useSession();
  const activeSquadId = usePlannerStore((state) => state.activeSquadId);
  const currentTasks = usePlannerStore((state) => state.tasks);
  const currentResources = usePlannerStore((state) => state.resources);
  const currentConfig = usePlannerStore((state) => state.config);
  const restoreSprintFromHistory = usePlannerStore((state) => state.restoreSprintFromHistory);
  const canRestoreSprint =
    !!session?.user?.role &&
    getCapabilities(plannerAccessContext(session, activeSquadId)).canManageSprintLifecycle;
  const [items, setItems] = useState<SprintHistoryListItem[]>([]);
  const [detailById, setDetailById] = useState<Record<string, SprintHistoryEntry>>({});
  const [selectedEntryId, setSelectedEntryId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [restoreFeedback, setRestoreFeedback] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    const suffix = activeSquadId ? `?squadId=${encodeURIComponent(activeSquadId)}` : "";
    const response = await fetch(`/api/history${suffix}`, { cache: "no-store" });
    const data = (await response.json()) as { items?: SprintHistoryListItem[] };
    return Array.isArray(data.items) ? data.items : [];
  }, [activeSquadId]);

  const fetchHistoryDetail = useCallback(
    async (id: string) => {
      if (!id || id === "__current_sprint__") return null;
      const params = new URLSearchParams({ id });
      if (activeSquadId) params.set("squadId", activeSquadId);
      const response = await fetch(`/api/history?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) return null;
      const data = (await response.json()) as { item?: SprintHistoryEntry };
      return data.item ?? null;
    },
    [activeSquadId],
  );

  const loadHistory = async () => {
    setLoading(true);
    try {
      setItems(await fetchHistory());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextItems = await fetchHistory();
        if (!cancelled) {
          setItems(nextItems);
          setDetailById({});
          setSelectedEntryId("");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchHistory]);

  const currentEntry = useMemo<SprintHistoryEntry>(
    () => ({
      id: "__current_sprint__",
      archivedAt: new Date().toISOString(),
      squadId: activeSquadId ?? "ventures",
      sprintStartDate: currentConfig.sprintStartDate,
      planningSunday: currentConfig.planningSunday,
      tasks: currentTasks,
      resources: currentResources,
      config: currentConfig,
      summary: {
        totalTasks: currentTasks.length,
        carryOverTasks: currentTasks.filter((task) => !!task.carryToNextSprint).length,
        totalResources: currentResources.length,
      },
    }),
    [activeSquadId, currentConfig, currentResources, currentTasks],
  );

  const listEntries = useMemo(
    () => [currentEntry, ...items] as Array<SprintHistoryListItem | SprintHistoryEntry>,
    [currentEntry, items],
  );

  useEffect(() => {
    if (!selectedEntryId || selectedEntryId === "__current_sprint__") return;
    if (detailById[selectedEntryId]) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for async detail fetch
    setDetailLoading(true);
    void (async () => {
      try {
        const detail = await fetchHistoryDetail(selectedEntryId);
        if (!cancelled && detail) {
          setDetailById((prev) => ({ ...prev, [detail.id]: detail }));
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally omit detailById — we only fetch when selection changes and cache miss.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cache checked via detailById[selectedEntryId] above
  }, [fetchHistoryDetail, selectedEntryId]);

  const selectedEntry = useMemo(() => {
    if (!selectedEntryId || selectedEntryId === "__current_sprint__" || selectedEntryId === currentEntry.id) {
      return currentEntry;
    }
    return detailById[selectedEntryId] ?? null;
  }, [currentEntry, detailById, selectedEntryId]);

  const isArchivedSelection =
    !!selectedEntry && selectedEntry.id !== "__current_sprint__" && selectedEntry.id !== currentEntry.id;

  const handleRestoreSelected = () => {
    if (!selectedEntry || !isArchivedSelection) {
      return;
    }
    if (
      !window.confirm(
        `Restore this archived sprint to the live dashboard?\n\n` +
          `Sprint start: ${selectedEntry.sprintStartDate}\n` +
          `Work items: ${selectedEntry.tasks.length}\n\n` +
          `This replaces the current live board. Save/sync will persist the restore.`,
      )
    ) {
      return;
    }
    restoreSprintFromHistory({
      tasks: selectedEntry.tasks,
      resources: selectedEntry.resources,
      config: selectedEntry.config,
    });
    const liveCount = usePlannerStore.getState().tasks.length;
    setSelectedEntryId("__current_sprint__");
    setRestoreFeedback(
      `Restored sprint from ${fmtDateTime(selectedEntry.archivedAt)} to the live board ` +
        `(archive ${selectedEntry.tasks.length} → live ${liveCount} stories).`,
    );
  };

  const scheduled = useMemo(() => {
    if (!selectedEntry) return null;
    return schedule(activeSprintTasks(selectedEntry.tasks), selectedEntry.resources, selectedEntry.config);
  }, [selectedEntry]);

  const taskResultMap = useMemo(
    () => new Map((scheduled?.tasks ?? []).map((item) => [item.id, item])),
    [scheduled],
  );

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="section-title">History</h1>
          <p className="mt-1 text-sm text-slate-500">
            Current sprint plus archived boards from Start New Sprint. Open an archive to review or restore it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="field-input px-2 py-1 text-sm"
            value={selectedEntryId || currentEntry.id}
            onChange={(event) => setSelectedEntryId(event.target.value)}
            disabled={listEntries.length === 0}
          >
            {listEntries.map((entry, index) => (
              <option key={entry.id} value={entry.id}>
                {entry.id === "__current_sprint__"
                  ? `Current Sprint (live) - ${entry.sprintStartDate}`
                  : `Sprint #${items.length - (index - 1)} - ${entry.sprintStartDate} - archived ${fmtDateTime(entry.archivedAt)}`}
              </option>
            ))}
          </select>
          {canRestoreSprint && isArchivedSelection ? (
            <button
              type="button"
              className="btn-primary px-2 py-1 text-sm"
              onClick={handleRestoreSelected}
              disabled={detailLoading}
            >
              Restore to live board
            </button>
          ) : null}
          <button type="button" className="btn-secondary px-2 py-1 text-sm" onClick={() => void loadHistory()}>
            Refresh
          </button>
        </div>
      </div>

      {restoreFeedback ? (
        <p className="shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {restoreFeedback}
        </p>
      ) : null}

      <section className="page-card flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-5">
        {!loading && !detailLoading && selectedEntry ? (
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-300 bg-blue-100/80 px-3 py-2 text-sm font-medium text-blue-900">
            <span className="min-w-0">
              Sprint start {format(parseCalendarDate(selectedEntry.config.sprintStartDate), "EEE dd MMM, yyyy")}
              <span className="mx-1.5 text-blue-800/70">·</span>
              Window ends {format(getSprintWindowEnd(selectedEntry.config), "EEE dd MMM, yyyy")}
            </span>
            <span className="text-right font-semibold text-blue-950">
              Stories: <span className="tabular-nums">{selectedEntry.tasks.length}</span> total
            </span>
          </div>
        ) : null}

        {detailLoading ? (
          <p className="mb-3 text-sm text-slate-500">Loading archived sprint…</p>
        ) : null}

        <div className="table-shell min-h-0 flex-1 overflow-auto">
          <table className="min-w-full table-fixed text-sm">
            <thead className="table-head">
              <tr>
                <th className="w-[15%] p-1 text-center">Story</th>
                <th className="w-[10%] p-1 text-center">Backend</th>
                <th className="w-[10%] p-1 text-center">Frontend</th>
                <th className="w-[10%] p-1 text-center">Mobile</th>
                <th className="w-[10%] p-1 text-center">Integration</th>
                <th className="w-[10%] p-1 text-center">QC</th>
                <th className="w-[4%] p-1 text-center">Buffer</th>
                <th className="w-[5%] p-1 text-center">Dev (h)</th>
                <th className="w-[5%] p-1 text-center">Total (h)</th>
                <th className="w-[6%] p-1 text-center">Status</th>
                <th className="w-[7%] p-1 text-center">Release Date</th>
                <th className="w-[4%] p-1 text-center">Flags</th>
                <th className="w-[4%] min-w-[6.5rem] p-1 text-center">Next Sprint</th>
              </tr>
            </thead>
            <tbody>
              {loading || detailLoading ? (
                <tr>
                  <td colSpan={13} className="p-4 text-center text-slate-600">
                    {detailLoading ? "Loading archived sprint..." : "Loading history..."}
                  </td>
                </tr>
              ) : null}
              {!loading && !detailLoading && !selectedEntry ? (
                <tr>
                  <td colSpan={13} className="p-4 text-center text-slate-600">
                    No sprint history yet. Create a new sprint to archive the current one.
                  </td>
                </tr>
              ) : null}
              {!loading && !detailLoading && selectedEntry
                ? selectedEntry.tasks.map((task) => {
                    const computed = taskResultMap.get(task.id);
                    const currentPhase = computed
                      ? getCurrentStoryPhase({ ...computed, replanFromStep: task.replanFromStep })
                      : getStatusPhase(task.status);
                    const phaseClass = (phase: StoryPhase) => (currentPhase === phase ? "phase-current" : "");
                    const storyLabel = (task.storyName ?? "").trim() || task.storyLink.trim() || task.id;
                    const storyLinkHref = storyHref(task.storyLink);
                    return (
                      <tr key={task.id} className={`border-t border-slate-200 align-top ${statusRowClass(task.status)}`}>
                        <td className="p-1">
                          <div className="mb-1 max-h-12 overflow-y-auto whitespace-normal break-words text-[12px] font-semibold text-slate-900">
                            {storyLinkHref ? (
                              <a
                                href={storyLinkHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-700 underline"
                              >
                                {storyLabel}
                              </a>
                            ) : (
                              <span>{storyLabel}</span>
                            )}
                          </div>
                          <div className="text-center text-[11px] font-semibold text-slate-600">
                            Priority (PO): {task.poPriority ?? "-"}
                          </div>
                        </td>
                        <td className="p-1">
                          <div className={`phase-be rounded-xl border p-1.5 text-[13px] ${phaseClass("BE")}`}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-semibold">BE Devs</span>
                              <span>{task.beHours}h</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {task.beDevs.length > 0 ? task.beDevs.map((name) => <span key={name} className="tag">{name}</span>) : "-"}
                            </div>
                          </div>
                        </td>
                        <td className="p-1">
                          <div className={`phase-fe rounded-xl border p-1.5 text-[13px] ${phaseClass("FE")}`}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-semibold">FE Devs</span>
                              <span>{task.feHours}h</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {task.feDevs.length > 0 ? task.feDevs.map((name) => <span key={name} className="tag">{name}</span>) : "-"}
                            </div>
                          </div>
                        </td>
                        <td className="p-1">
                          <div className={`phase-android rounded-xl border p-1.5 text-[13px] ${phaseClass("Android")}`}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-semibold">Android</span>
                              <span>{task.androidHours ?? 0}h</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {(task.androidDevs ?? []).length > 0
                                ? task.androidDevs.map((name) => <span key={name} className="tag">{name}</span>)
                                : "-"}
                            </div>
                            {task.moStartDate ? (
                              <div className="mt-1 text-[11px] font-medium text-current/80">Start {task.moStartDate}</div>
                            ) : null}
                            {task.needsIos ? (
                              <div className="mt-1.5 rounded-lg border border-current/20 bg-white/40 p-1.5">
                                <div className="mb-1 flex items-center justify-between">
                                  <span className="font-semibold">IOS</span>
                                  <span>{task.iosHours ?? 0}h</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {(task.iosDevs ?? []).length > 0
                                    ? task.iosDevs.map((name) => <span key={name} className="tag">{name}</span>)
                                    : "-"}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="p-1">
                          <div className={`phase-int rounded-xl border p-1.5 text-[13px] ${phaseClass("Integration")}`}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-semibold">Integration</span>
                              <span>{task.integrationHours}h</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {task.integrationFlags?.needsDevOps ? <span className="tag">DevOps</span> : null}
                              {task.integrationFlags?.needsCdc ? <span className="tag">CDC</span> : null}
                              {task.integrationFlags?.needsDbSync ? <span className="tag">DB Sync</span> : null}
                              {task.integrationFlags?.needsOtherSquad ? <span className="tag">Other Squad</span> : null}
                              {task.integrationFlags?.needsThirdParty ? <span className="tag">3rd Party</span> : null}
                              {!task.integrationFlags?.needsDevOps &&
                              !task.integrationFlags?.needsCdc &&
                              !task.integrationFlags?.needsDbSync &&
                              !task.integrationFlags?.needsOtherSquad &&
                              !task.integrationFlags?.needsThirdParty
                                ? "-"
                                : null}
                            </div>
                          </div>
                        </td>
                        <td className="p-1">
                          <div className={`phase-qc rounded-xl border p-1.5 text-[13px] ${phaseClass("QC")}`}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-semibold">QC Eng</span>
                              <span>{task.qcHours}h</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {task.qcs.length > 0 ? task.qcs.map((name) => <span key={name} className="tag">{name}</span>) : "-"}
                            </div>
                          </div>
                        </td>
                        <td className="p-1 text-center text-[12px] font-semibold text-slate-700">{task.bufferHours ?? 0}h</td>
                        <td className="p-1 text-center text-[12px] font-semibold text-slate-700">{developmentHours(task)}h</td>
                        <td className="p-1 text-center text-[12px] font-semibold text-slate-700">{totalEffortHours(task)}h</td>
                        <td className="p-1 text-center text-[12px] font-semibold text-slate-900">{task.status}</td>
                        <td className="p-1 align-middle text-center text-[12px] font-bold text-slate-900">
                          {releaseDateHandoffLabel(task.status) ? (
                            <span className="text-slate-700">{releaseDateHandoffLabel(task.status)}</span>
                          ) : computed?.releaseDate ? (
                            <div className="flex flex-col items-center justify-center leading-tight">
                              <span>{fmtDateOnly(computed.releaseDate)}</span>
                              <span className="text-[10px] text-slate-800">{fmtTimeOnly(computed.releaseDate)}</span>
                            </div>
                          ) : canCalculateRelease(task) ? (
                            <span className="text-slate-700">Pending schedule</span>
                          ) : (
                            <span className="text-slate-700">Add hours</span>
                          )}
                        </td>
                        <td className="p-1">
                          <div className="flex min-h-[3.1rem] flex-col items-start gap-1">
                            {computed?.isOverflow ? <span className="tag bg-red-100 text-red-700">Overflow</span> : null}
                            {computed
                              ? (() => {
                                  const thursdayLabel = thursdayReleaseChipLabel(computed.thursdayReleaseScope);
                                  return thursdayLabel ? (
                                    <span className="tag bg-pink-100 text-pink-700">{thursdayLabel}</span>
                                  ) : null;
                                })()
                              : null}
                          </div>
                        </td>
                        <td className="p-1 text-center">
                          <span
                            className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${
                              task.carryToNextSprint
                                ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                                : "border-slate-300 bg-slate-100 text-slate-700"
                            }`}
                          >
                            {task.carryToNextSprint ? "✓ Next Sprint" : "Current Sprint"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

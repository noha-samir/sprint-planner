"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { getCapabilities, plannerAccessContext } from "@/lib/access/control";
import { getSprintWorkingDayCountInWindow, totalWorkingHoursForSprint } from "@/lib/scheduler/calendar";
import {
  capacityDayBreakdownCopy,
  devCapacityFromAssignedHours,
  sprintCapacityBreakdown,
} from "@/lib/scheduler/capacityBreakdown";
import { resolveOtherSquadsHours } from "@/lib/scheduler/utilization";
import { SQUAD_CAPACITY_HOURS_MAX, type Resource, type ResourceType } from "@/lib/scheduler/types";
import { usePlannerStore } from "@/store/usePlannerStore";
import { ResourceInsightModal } from "@/components/resources/ResourceInsightModal";
import { AddJiraPersonModal } from "@/components/resources/AddJiraPersonModal";
import { JiraConnectionFields } from "@/components/resources/JiraConnectionFields";
import type { SquadJiraConfig } from "@/lib/integrations/jira/types";

const mainTeamSections: Array<{ type: ResourceType; title: string; short: string; phaseClass: string }> = [
  { type: "BE", title: "Backend", short: "Backend team", phaseClass: "phase-be" },
  { type: "FE", title: "Frontend", short: "Frontend team", phaseClass: "phase-fe" },
  { type: "MO", title: "Mobile", short: "Mobile team", phaseClass: "phase-mo" },
  { type: "QC", title: "Quality Control", short: "QC team", phaseClass: "phase-qc" },
];

const productManagerSection = {
  type: "PM" as const,
  title: "Product Manager",
  short: "Product Manager team",
  phaseClass: "phase-pm",
};

const otherSquadSection = {
  type: "OtherSquad" as const,
  title: "Other Squad",
  short: "Other Squad team",
  phaseClass: "phase-int",
};

export function ResourceTable() {
  const { data: session } = useSession();
  const activeSquadId = usePlannerStore((state) => state.activeSquadId);
  const role = session?.user?.role;
  const caps = getCapabilities(plannerAccessContext(session, activeSquadId));
  const isEditor = !!role && caps.canEditOpsTabs;
  const isSuperAdmin = !!role && caps.canManageUsers;
  const resources = usePlannerStore((state) => state.resources);
  const config = usePlannerStore((state) => state.config);
  const addMappedResource = usePlannerStore((state) => state.addMappedResource);
  const updateResource = usePlannerStore((state) => state.updateResource);
  const removeResource = usePlannerStore((state) => state.removeResource);
  const remainingUtilization = usePlannerStore((state) => state.remainingUtilization);
  const sprintUtilization = usePlannerStore((state) => state.sprintUtilization);
  const applyJiraResourceRenames = usePlannerStore((state) => state.applyJiraResourceRenames);

  const [isCalcInfoOpen, setIsCalcInfoOpen] = useState(false);
  const [insightResourceName, setInsightResourceName] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ type: ResourceType; index: number } | null>(null);
  const [addTeamType, setAddTeamType] = useState<ResourceType | null>(null);
  const [assigneeMap, setAssigneeMap] = useState<Record<string, string>>({});
  const [assigneeMapReady, setAssigneeMapReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [pageTab, setPageTab] = useState<"roster" | "jira">("roster");
  const scrollerRef = useRef<HTMLDivElement>(null);

  const sprintWorkingDays = getSprintWorkingDayCountInWindow(config);
  const totalWorkingHours = Math.min(SQUAD_CAPACITY_HOURS_MAX, totalWorkingHoursForSprint(config));
  const capacityBreakdown = sprintCapacityBreakdown(config, sprintWorkingDays, totalWorkingHours);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const squadHeaders = useMemo((): Record<string, string> => {
    if (!activeSquadId) return {};
    return { "x-squad-id": activeSquadId };
  }, [activeSquadId]);

  useEffect(() => {
    if (!isSuperAdmin) {
      setPageTab("roster");
      return;
    }
    const applyHash = () => {
      if (window.location.hash === "#jira-connection") {
        setPageTab("jira");
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [isSuperAdmin]);

  const selectPageTab = (tab: "roster" | "jira") => {
    setPageTab(tab);
    if (typeof window === "undefined") return;
    if (tab === "jira") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#jira-connection`);
    } else if (window.location.hash === "#jira-connection") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  };

  useEffect(() => {
    if (!isSuperAdmin || !activeSquadId) {
      setAssigneeMap({});
      setAssigneeMapReady(true);
      return;
    }
    setAssigneeMapReady(false);
    const controller = new AbortController();
    void (async () => {
      const response = await fetch("/api/integrations/jira/config", {
        cache: "no-store",
        headers: squadHeaders,
        signal: controller.signal,
      });
      if (!response.ok) {
        setAssigneeMapReady(true);
        return;
      }
      const body = (await response.json()) as SquadJiraConfig;
      setAssigneeMap(body.assigneeMap ?? {});
      setAssigneeMapReady(true);
    })().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setAssigneeMapReady(true);
    });
    return () => controller.abort();
  }, [isSuperAdmin, activeSquadId, squadHeaders]);

  useEffect(() => {
    if (!isSuperAdmin || !activeSquadId) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/integrations/jira/assignees/seed-pms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...squadHeaders },
        body: JSON.stringify({}),
      });
      if (!response.ok || cancelled) return;
      const body = (await response.json()) as {
        created?: Array<{ name: string }>;
        failed?: Array<{ query: string; reason: string }>;
      };
      if ((body.created?.length ?? 0) === 0 && (body.failed?.length ?? 0) === 0) return;
      for (const row of body.created ?? []) {
        addMappedResource({
          name: row.name,
          type: "PM",
          ownershipMode: "shared",
          ourSquadHours: totalWorkingHours,
          capacityHours: totalWorkingHours,
        });
      }
      const parts: string[] = [];
      if ((body.created?.length ?? 0) > 0) {
        parts.push(`Seeded PMs: ${(body.created ?? []).map((row) => row.name).join(", ")}`);
      }
      if ((body.failed?.length ?? 0) > 0) {
        parts.push(
          `Could not seed: ${(body.failed ?? []).map((row) => `${row.query} (${row.reason})`).join("; ")}`,
        );
      }
      if (parts.length > 0 && !cancelled) {
        if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
        setBanner(parts.join(" · "));
        bannerTimerRef.current = setTimeout(() => {
          setBanner(null);
          bannerTimerRef.current = null;
        }, 10_000);
      }
      const configRes = await fetch("/api/integrations/jira/config", {
        cache: "no-store",
        headers: squadHeaders,
      });
      if (configRes.ok) {
        const configBody = (await configRes.json()) as SquadJiraConfig;
        setAssigneeMap(configBody.assigneeMap ?? {});
        setAssigneeMapReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot seed per squad
  }, [isSuperAdmin, activeSquadId, squadHeaders]);

  useEffect(() => {
    if (!pendingFocus) return;
    const { type, index } = pendingFocus;
    const root = scrollerRef.current;
    if (!root) return;
    const board = root.querySelector<HTMLElement>(`[data-team-board][data-team-type="${type}"]`);
    if (!board) return;
    board.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const card = board.querySelector<HTMLElement>(`[data-resource-card][data-resource-index="${index}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setPendingFocus(null);
  }, [pendingFocus, resources]);

  const clearBanner = () => {
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
    setBanner(null);
  };

  const showBanner = (message: string) => {
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
    }
    setBanner(message);
    bannerTimerRef.current = setTimeout(() => {
      setBanner(null);
      bannerTimerRef.current = null;
    }, 10_000);
  };

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  const scrollTeams = (direction: -1 | 1) => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({ top: direction * node.clientHeight, behavior: "smooth" });
  };

  const handleAddClick = (type: ResourceType) => {
    if (!isSuperAdmin) {
      showBanner("Only super admins can add people (must pick from Jira).");
      return;
    }
    setAddTeamType(type);
  };

  const handleCreated = (resource: Resource, nextMap?: Record<string, string>) => {
    addMappedResource(resource);
    if (nextMap) {
      setAssigneeMap(nextMap);
      setAssigneeMapReady(true);
    }
    const newIndex = usePlannerStore.getState().resources.findIndex((row) => row.name === resource.name);
    if (newIndex >= 0) {
      setPendingFocus({ type: resource.type, index: newIndex });
    }
    showBanner(`Added ${resource.name} from Jira (account saved).`);
    if (!nextMap) {
      void fetch("/api/integrations/jira/config", { cache: "no-store", headers: squadHeaders })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: SquadJiraConfig | null) => {
          if (body?.assigneeMap) {
            setAssigneeMap(body.assigneeMap);
            setAssigneeMapReady(true);
          }
        });
    }
  };

  const handleRemove = (index: number) => {
    const removed = resources[index];
    removeResource(index);
    if (!removed?.name) return;
    // Drop that person's saved account immediately — mapping is only created at Add time.
    void fetch("/api/integrations/jira/assignees/prune", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...squadHeaders },
      body: JSON.stringify({ dropNames: [removed.name] }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { config?: SquadJiraConfig } | null) => {
        if (body?.config?.assigneeMap) setAssigneeMap(body.config.assigneeMap);
      });
  };

  const refreshFromJira = async () => {
    setRefreshing(true);
    clearBanner();
    try {
      const response = await fetch("/api/integrations/jira/assignees/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...squadHeaders },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        showBanner(body.error ?? "Failed to refresh from Jira");
        return;
      }
      const body = (await response.json()) as {
        config: SquadJiraConfig;
        renames?: Array<{ from: string; to: string }>;
      };
      setAssigneeMap(body.config.assigneeMap ?? {});
      if ((body.renames?.length ?? 0) > 0) {
        applyJiraResourceRenames(body.renames ?? []);
        showBanner(
          `Refreshed from Jira — renamed: ${(body.renames ?? []).map((row) => `${row.from} → ${row.to}`).join(", ")}`,
        );
      } else {
        showBanner("Refreshed from Jira — names already up to date.");
      }
    } finally {
      setRefreshing(false);
    }
  };

  const renderMemberCard = (item: Resource, index: number, phaseClass: string) => {
    const remainingUtil = remainingUtilization.find(
      (entry) => entry.name === item.name && entry.type === item.type,
    );
    const sprintUtil = sprintUtilization.perMember.find(
      (entry) => entry.name === item.name && entry.type === item.type,
    );
    const originUtil = sprintUtilization.perMemberByOrigin.find(
      (entry) => entry.name === item.name && entry.type === item.type,
    );
    const assignedOurSquadHours = remainingUtil
      ? remainingUtil.assignedOurSquadHours
      : item.ourSquadHours ?? totalWorkingHours;
    const otherSquadsHours = resolveOtherSquadsHours(totalWorkingHours, assignedOurSquadHours);
    const takenHours = sprintUtil ? sprintUtil.takenHours : 0;
    const newSprintTaken = originUtil?.newSprintTakenHours ?? 0;
    const carryOverTaken = originUtil?.carryOverTakenHours ?? 0;
    const devCapacityHours = devCapacityFromAssignedHours(assignedOurSquadHours, config.hoursPerDay);
    const remainingHours = Math.max(0, devCapacityHours - takenHours);
    const overloadHours = Math.max(0, takenHours - devCapacityHours);
    const utilizationPct =
      devCapacityHours > 0 ? Math.min(999, Math.round((takenHours / devCapacityHours) * 100)) : 0;
    const isFullyMine = item.ownershipMode === "fullyMine";
    const mappedAccountId =
      assigneeMap[item.name]?.trim() ||
      Object.entries(assigneeMap).find(
        ([name, accountId]) =>
          name.trim().toLowerCase() === item.name.trim().toLowerCase() && Boolean(accountId?.trim()),
      )?.[1];
    const mapped = Boolean(mappedAccountId?.trim());

    return (
      <div
        key={`${item.name}-${index}`}
        data-resource-card
        data-resource-index={index}
        role="button"
        tabIndex={0}
        className={`flex min-h-0 cursor-pointer flex-col rounded-xl border p-1.5 ${phaseClass}`}
        title="Click to view assigned tasks"
        onClick={() => setInsightResourceName(item.name)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setInsightResourceName(item.name);
          }
        }}
      >
        <div className="flex min-w-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <div
            className="field-input min-w-0 flex-1 cursor-default truncate bg-white/80 px-1.5 py-1 text-[12px] font-semibold text-slate-900"
            title={item.name}
          >
            {item.name}
          </div>
          {isSuperAdmin && assigneeMapReady ? (
            <span
              className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${
                mapped ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
              }`}
              title={
                mapped
                  ? "Jira account saved at Add time"
                  : "Not mapped — remove and Add again from Jira"
              }
            >
              {mapped ? "Jira" : "?"}
            </span>
          ) : null}
          {isSuperAdmin ? (
            <button
              type="button"
              className="btn-danger shrink-0 px-1.5 py-1 text-[11px] disabled:opacity-50"
              onClick={() => handleRemove(index)}
            >
              ✕
            </button>
          ) : null}
        </div>
        <div className="mt-1 space-y-1 rounded-lg border border-white/40 bg-white/50 p-1.5">
          <div className="grid min-w-0 grid-cols-3 gap-1" onClick={(event) => event.stopPropagation()}>
            <label className="text-center text-[9px] font-semibold text-slate-800">
              Ownership
              <select
                disabled={!isEditor}
                className="field-input mt-0.5 px-1 py-0.5 text-center text-[10px]"
                value={item.ownershipMode ?? "shared"}
                onChange={(event) => {
                  const nextMode = event.target.value as "fullyMine" | "shared";
                  updateResource(index, {
                    ...item,
                    ownershipMode: nextMode,
                    ourSquadHours:
                      nextMode === "fullyMine" ? totalWorkingHours : item.ourSquadHours ?? totalWorkingHours,
                  });
                }}
              >
                <option value="fullyMine">FullyMine</option>
                <option value="shared">Shared</option>
              </select>
            </label>
            <label className="text-center text-[9px] font-semibold text-slate-800">
              Our hours
              <input
                type="number"
                min={0}
                max={totalWorkingHours}
                disabled={!isEditor || isFullyMine}
                className="field-input mt-0.5 px-1 py-0.5 text-center text-[10px] font-semibold tabular-nums"
                value={Math.round(assignedOurSquadHours)}
                onChange={(event) =>
                  updateResource(index, {
                    ...item,
                    ownershipMode: item.ownershipMode ?? "shared",
                    ourSquadHours: Math.max(0, Math.min(totalWorkingHours, Number(event.target.value) || 0)),
                  })
                }
              />
            </label>
            <div className="text-center text-[9px] font-semibold text-slate-800">
              Other hours
              <div className="field-input mt-0.5 inline-flex w-full items-center justify-center bg-white/90 px-1 py-0.5 text-[10px] font-bold tabular-nums text-slate-900">
                {Math.round(otherSquadsHours)}h
              </div>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-3 gap-1 text-[9px]">
            <div className="rounded-md border border-white/50 bg-white/70 px-1.5 py-1">
              <div className="font-semibold text-slate-700">Taken / Rem</div>
              <div className="font-bold tabular-nums text-slate-900">
                {Math.round(takenHours)}h / {Math.round(remainingHours)}h
              </div>
              {carryOverTaken > 0 ? (
                <div className="mt-0.5 text-[8px] leading-tight text-slate-600">
                  New {Math.round(newSprintTaken)}h · Carry {Math.round(carryOverTaken)}h
                </div>
              ) : (
                <div className="mt-0.5 text-[8px] leading-tight text-slate-600">Dev hours only</div>
              )}
            </div>
            <div className="rounded-md border border-white/50 bg-white/70 px-1.5 py-1">
              <div className="font-semibold text-slate-700">Util %</div>
              <div className="font-bold tabular-nums text-slate-900">{utilizationPct}%</div>
            </div>
            <div className="rounded-md border border-white/50 bg-white/70 px-1.5 py-1">
              <div className="font-semibold text-slate-700">Total</div>
              <div className="font-bold tabular-nums text-slate-900">{Math.round(totalWorkingHours)}h</div>
              <button
                type="button"
                className="mt-0.5 block w-full text-center text-[8px] font-semibold text-blue-800 underline"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsCalcInfoOpen(true);
                }}
              >
                How?
              </button>
            </div>
          </div>
          {takenHours > devCapacityHours ? (
            <div className="flex justify-end">
              <span className="tag bg-yellow-100 text-[9px] text-yellow-700">
                Overload +{Math.round(overloadHours)}h
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderTeamBoard = (section: {
    type: ResourceType;
    title: string;
    short: string;
    phaseClass: string;
  }) => {
    const sectionRows = resources
      .map((resource, index) => ({ resource, index }))
      .filter(({ resource }) => resource.type === section.type);

    return (
      <section
        key={section.type}
        data-team-board
        data-team-type={section.type}
        className="flex min-h-0 flex-col overflow-hidden rounded-3xl border-2 border-slate-300 bg-white shadow-sm"
      >
        <header className={`shrink-0 border-b border-black/10 px-3 py-1.5 ${section.phaseClass}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <h3 className="text-lg font-black tracking-tight text-slate-900 sm:text-xl">{section.short}</h3>
              <p className="truncate text-[11px] font-semibold text-slate-700">
                {section.title} · {sectionRows.length} {sectionRows.length === 1 ? "person" : "people"}
              </p>
            </div>
            <button
              type="button"
              disabled={!isSuperAdmin}
              className="btn-primary shrink-0 px-2 py-1 text-[12px] disabled:opacity-50"
              title={isSuperAdmin ? "Add person from Jira" : "Only super admins can add people"}
              onClick={() => handleAddClick(section.type)}
            >
              Add
            </button>
          </div>
        </header>

        <div data-team-list className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">
          {sectionRows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
              No members yet. {isSuperAdmin ? "Click Add to pick from Jira." : ""}
            </p>
          ) : (
            <div className="grid auto-rows-min grid-cols-2 gap-2">
              {sectionRows.map(({ resource: item, index }) =>
                renderMemberCard(item, index, section.phaseClass),
              )}
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            pageTab === "roster"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
          onClick={() => selectPageTab("roster")}
        >
          Resources
        </button>
        {isSuperAdmin ? (
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              pageTab === "jira"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            onClick={() => selectPageTab("jira")}
          >
            Jira fields
          </button>
        ) : null}
      </div>

      {pageTab === "jira" && isSuperAdmin ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <JiraConnectionFields squadHeaders={squadHeaders} />
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {isSuperAdmin ? (
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                disabled={refreshing}
                onClick={() => void refreshFromJira()}
              >
                {refreshing ? "Refreshing names…" : "Refresh names from Jira"}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              aria-label="Scroll to previous teams"
              onClick={() => scrollTeams(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              aria-label="Scroll to next teams"
              onClick={() => scrollTeams(1)}
            >
              ↓
            </button>
          </div>

          {banner ? (
            <div
              className="flex shrink-0 items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
              role="status"
            >
              <p className="min-w-0 flex-1">{banner}</p>
              <button
                type="button"
                className="shrink-0 rounded-md px-1.5 py-0.5 text-base leading-none text-blue-800 hover:bg-blue-100"
                aria-label="Dismiss notification"
                onClick={clearBanner}
              >
                ×
              </button>
            </div>
          ) : null}

          <div
            ref={scrollerRef}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] snap-y snap-mandatory"
          >
            <div
              data-team-row
              className="grid h-full min-h-full snap-start grid-cols-1 grid-rows-4 gap-3 py-1 sm:grid-cols-2 sm:grid-rows-2"
            >
              {mainTeamSections.map((section) => renderTeamBoard(section))}
            </div>
            <div
              data-team-row
              className="grid h-full min-h-full snap-start grid-cols-1 grid-rows-2 gap-3 py-1 sm:grid-cols-2 sm:grid-rows-1"
            >
              {renderTeamBoard(productManagerSection)}
              {renderTeamBoard(otherSquadSection)}
            </div>
          </div>
        </>
      )}

      <AddJiraPersonModal
        open={addTeamType != null}
        teamType={addTeamType}
        squadHeaders={squadHeaders}
        capacityHours={totalWorkingHours}
        onClose={() => setAddTeamType(null)}
        onCreated={handleCreated}
      />

      {isCalcInfoOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setIsCalcInfoOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-base font-semibold text-slate-900">Capacity & utilization</h3>
            <div className="mt-2 space-y-1 text-[12px] text-slate-700">
              <p>
                Working days: <span className="font-bold">{sprintWorkingDays}</span>
              </p>
              <p>
                Total: <span className="font-bold">{Math.round(totalWorkingHours)}h</span> (
                {sprintWorkingDays} × {config.hoursPerDay}h/day)
              </p>
              <p>
                Dev: <span className="font-bold">{capacityBreakdown.devHours}h</span> · Preparations:{" "}
                <span className="font-bold">{capacityBreakdown.prepHours}h</span>
              </p>
              <p className="text-slate-600">{capacityDayBreakdownCopy(config.hoursPerDay)}</p>
              <p className="text-slate-600">
                Taken / Rem uses dev capacity only. UAT and Production stories are excluded from Taken.
              </p>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-[12px]"
                onClick={() => setIsCalcInfoOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ResourceInsightModal
        resourceName={insightResourceName}
        onClose={() => setInsightResourceName(null)}
      />
    </div>
  );
}

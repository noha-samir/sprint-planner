"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSprintWorkingDayCountInWindow, totalWorkingHoursForSprint } from "@/lib/scheduler/calendar";
import { matchResourceByAssigneeLabel, resourceDisplayName } from "@/lib/planner/resourceIdentity";
import { resolveOtherSquadsHours } from "@/lib/scheduler/utilization";
import {
  RESOURCE_INSIGHT_BUCKET_LABELS,
  resourceInsightStatusBucket,
  resourceInsightStatusRank,
  statusChipClass,
  type ResourceInsightStatusBucket,
} from "@/lib/scheduler/taskStatus";
import { SQUAD_CAPACITY_HOURS_MAX, type Resource, type Task } from "@/lib/scheduler/types";
import { usePlannerStore } from "@/store/usePlannerStore";
import { safeStoryHref } from "@/lib/ui/safeStoryHref";

type Props = {
  resourceName: string | null;
  onClose: () => void;
};

type InsightTaskRow = {
  taskId: string;
  storyLabel: string;
  storyLink: string;
  /** Exact Jira / planner status name shown to the user. */
  status: string;
  totalHours: number;
};

const phaseCardClass = (resource: Resource | null) => {
  if (!resource) return "phase-int";
  if (resource.type === "BE") return "phase-be";
  if (resource.type === "FE") return "phase-fe";
  if (resource.type === "MO") return "phase-mo";
  if (resource.type === "QC") return "phase-qc";
  if (resource.type === "PM") return "phase-pm";
  return "phase-int";
};

const hoursForResourceOnTask = (task: Task, resource: Resource): number => {
  if (resource.type === "BE") {
    const assignees = task.beDevs?.length ? task.beDevs : [];
    if (assignees.includes(resource.name) && assignees.length > 0) {
      return task.beHours / assignees.length;
    }
    return 0;
  }
  if (resource.type === "FE") {
    const assignees = task.feDevs?.length ? task.feDevs : [];
    if (assignees.includes(resource.name) && assignees.length > 0) {
      return task.feHours / assignees.length;
    }
    return 0;
  }
  if (resource.type === "MO") {
    let total = 0;
    const androidAssignees = task.androidDevs?.length ? task.androidDevs : [];
    if (androidAssignees.includes(resource.name) && androidAssignees.length > 0) {
      total += (task.androidHours ?? 0) / androidAssignees.length;
    }
    const iosAssignees = task.needsIos && task.iosDevs?.length ? task.iosDevs : [];
    if (iosAssignees.includes(resource.name) && iosAssignees.length > 0) {
      total += (task.needsIos ? Math.max(0, task.iosHours ?? 0) : 0) / iosAssignees.length;
    }
    return total;
  }
  if (resource.type === "QC") {
    const assignees = task.qcs?.length ? task.qcs : [];
    if (assignees.includes(resource.name) && assignees.length > 0) {
      return task.qcHours / assignees.length;
    }
  }
  if (resource.type === "PM") {
    // PM has no scheduled hours — still surface assigned stories in the insight modal.
    return task.productManagers?.includes(resource.name) ? 0.01 : 0;
  }
  return 0;
};

export function ResourceInsightModal({ resourceName, onClose }: Props) {
  const pathname = usePathname();
  const { resources, tasks, config, remainingUtilization, sprintUtilization } = usePlannerStore();
  const resource =
    (resourceName ? matchResourceByAssigneeLabel(resourceName, resources) : null) ??
    (resourceName ? resources.find((item) => item.name === resourceName) ?? null : null);
  const resolvedResourceName = resource?.name ?? resourceName ?? "";
  const displayTitle = resource ? resourceDisplayName(resource) : resolvedResourceName;
  const sprintWorkingDays = getSprintWorkingDayCountInWindow(config);
  const devHoursPerResource = sprintWorkingDays * 6;
  const meetingsHoursPerResource = sprintWorkingDays * 2;
  const totalWorkingHours = Math.min(SQUAD_CAPACITY_HOURS_MAX, totalWorkingHoursForSprint(config));
  const remainingUtil = remainingUtilization.find(
    (entry) => entry.name === resolvedResourceName && entry.type === resource?.type,
  );
  const sprintUtil = sprintUtilization.perMember.find(
    (entry) => entry.name === resolvedResourceName && entry.type === resource?.type,
  );
  const assignedOurSquadHours = remainingUtil
    ? remainingUtil.assignedOurSquadHours
    : resource?.ourSquadHours ?? totalWorkingHours;
  const otherSquadsHours = resolveOtherSquadsHours(totalWorkingHours, assignedOurSquadHours);
  const takenHours = sprintUtil ? sprintUtil.takenHours : 0;
  const devCapacityHours = (assignedOurSquadHours * 6) / Math.max(1, config.hoursPerDay);
  const remainingHours = Math.max(0, devCapacityHours - takenHours);
  const overloadHours = Math.max(0, takenHours - devCapacityHours);
  const utilizationPct =
    devCapacityHours > 0 ? Math.min(999, Math.round((takenHours / devCapacityHours) * 100)) : 0;

  const assignedTasks: InsightTaskRow[] = resource
    ? tasks
        .filter((task) => !task.carryToNextSprint)
        .map((task) => {
          const totalHours = hoursForResourceOnTask(task, resource);
          if (totalHours <= 0) return null;
          return {
            taskId: task.id,
            storyLabel: task.storyName || task.storyLink || task.id,
            storyLink: task.storyLink,
            status: task.status,
            totalHours,
          } satisfies InsightTaskRow;
        })
        .filter((row): row is InsightTaskRow => row != null)
        .sort((a, b) => {
          const rankDiff = resourceInsightStatusRank(a.status) - resourceInsightStatusRank(b.status);
          if (rankDiff !== 0) return rankDiff;
          return b.totalHours - a.totalHours;
        })
    : [];

  const tasksByBucket = assignedTasks.reduce(
    (acc, row) => {
      const bucket = resourceInsightStatusBucket(row.status);
      acc[bucket].push(row);
      return acc;
    },
    {
      todo: [] as InsightTaskRow[],
      "in-progress": [] as InsightTaskRow[],
      "in-review": [] as InsightTaskRow[],
      done: [] as InsightTaskRow[],
    } satisfies Record<ResourceInsightStatusBucket, InsightTaskRow[]>,
  );

  const bucketOrder: ResourceInsightStatusBucket[] = ["todo", "in-progress", "in-review", "done"];

  if (!resourceName) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-300 bg-white p-3 shadow-sm"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-insight-title"
      >
        <div className={`flex min-h-0 flex-col rounded-xl border p-2 ${phaseCardClass(resource)}`}>
          <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <div
              id="resource-insight-title"
              className="field-input min-w-0 flex-1 cursor-default bg-white/70 py-2 text-sm font-semibold text-slate-900"
            >
              {displayTitle}
            </div>
            <button
              type="button"
              className="btn-secondary shrink-0 self-start px-2 py-1 text-[13px] sm:self-center"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          {resource ? (
            <>
              <div className="mt-1.5 grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                <div className="flex flex-col items-center gap-1 rounded-lg border border-white/40 bg-white/50 px-2 py-1.5">
                  <span
                    className="text-center text-[10px] font-semibold leading-tight text-slate-800"
                    title="Configured hours assigned to this resource in our squad."
                  >
                    Hours in our squad
                  </span>
                  <div
                    className="field-input w-full min-w-0 cursor-default bg-white/90 px-2 py-1 text-center text-[13px] font-semibold tabular-nums text-slate-900"
                    title="Hours in our squad."
                  >
                    {Math.round(assignedOurSquadHours)}h
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1 rounded-lg border border-white/40 bg-white/50 px-2 py-1.5">
                  <span
                    className="text-center text-[10px] font-semibold leading-tight text-slate-800"
                    title="Derived from total working hours minus our squad hours."
                  >
                    Hours in other squads
                  </span>
                  <div
                    className="flex items-baseline justify-center gap-0.5 tabular-nums text-sm font-bold text-slate-900"
                    title={`${Math.round(totalWorkingHours)}h total − ${Math.round(assignedOurSquadHours)}h in our squad`}
                  >
                    <span>{Math.round(otherSquadsHours)}</span>
                    <span className="text-[12px] font-semibold text-slate-800">h</span>
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 rounded-lg border border-white/40 bg-white/50 px-2 py-1.5">
                  <span
                    className="text-[10px] font-semibold leading-tight text-slate-800"
                    title="Total available working hours in this sprint (excluding planning day and vacations)."
                  >
                    Total working hours
                  </span>
                  <div className="text-left text-[10px] tabular-nums text-slate-900">
                    <span className="font-bold">{Math.round(totalWorkingHours)}</span>h: (
                    <span className="font-bold">{sprintWorkingDays}</span> working days ×{" "}
                    <span className="font-bold">{config.hoursPerDay}</span>h/day)
                  </div>
                  <div className="text-left text-[10px] text-slate-700">
                    Dev: <span className="font-bold">{devHoursPerResource}</span>h (
                    <span className="font-bold">{sprintWorkingDays}</span> working days ×{" "}
                    <span className="font-bold">6</span>h/day)
                  </div>
                  <div className="text-left text-[10px] text-slate-700">
                    Preparations: <span className="font-bold">{meetingsHoursPerResource}</span>h (
                    <span className="font-bold">{sprintWorkingDays}</span> working days ×{" "}
                    <span className="font-bold">2</span>h/day)
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1 rounded-lg border border-white/40 bg-white/50 px-2 py-1.5">
                  <span
                    className="text-center text-[10px] font-semibold leading-tight text-slate-800"
                    title="Taken vs remaining dev hours in our squad (preparations excluded)."
                  >
                    Taken / Remaining (Dev)
                  </span>
                  <div className="text-center text-sm font-bold tabular-nums text-slate-900">
                    {Math.round(takenHours)}h / {Math.round(remainingHours)}h
                  </div>
                  <div className="text-center text-[10px] font-semibold tabular-nums text-slate-600">
                    excludes preparations hours
                  </div>
                  <div className="text-center text-[11px] font-semibold tabular-nums text-slate-700">
                    Utilization in our squad: {utilizationPct}%
                  </div>
                  {takenHours > devCapacityHours ? (
                    <div className="flex w-full justify-center">
                      <span className="tag bg-yellow-100 text-yellow-700">
                        Overload +{Math.round(overloadHours)}h
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-2 rounded-lg border border-white/40 bg-white/50 p-2">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-800">
                    Tasks ({assignedTasks.length})
                  </span>
                  <span className="text-[10px] font-medium text-slate-600">
                    To Do → In Progress → In Review → Done
                  </span>
                </div>
                <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                  {assignedTasks.length === 0 ? (
                    <p className="text-[12px] text-slate-600">No assigned story hours for this resource.</p>
                  ) : (
                    bucketOrder.map((bucket) => {
                      const rows = tasksByBucket[bucket];
                      if (rows.length === 0) return null;
                      return (
                        <div key={bucket} className="space-y-1">
                          <div className="sticky top-0 z-[1] bg-white/90 px-0.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 backdrop-blur-sm">
                            {RESOURCE_INSIGHT_BUCKET_LABELS[bucket]} · {rows.length}
                          </div>
                          {rows.map((entry) => {
                            const href = safeStoryHref(entry.storyLink);
                            return (
                              <div
                                key={entry.taskId}
                                className="rounded border border-white/50 bg-white/70 p-1.5"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  {href ? (
                                    <a
                                      href={href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="line-clamp-2 text-[12px] font-semibold text-blue-700 underline"
                                    >
                                      {entry.storyLabel}
                                    </a>
                                  ) : (
                                    <span className="line-clamp-2 text-[12px] font-semibold text-slate-800">
                                      {entry.storyLabel}
                                    </span>
                                  )}
                                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                                    <span className="text-[12px] font-bold tabular-nums text-slate-900">
                                      {Math.round(entry.totalHours)}h
                                    </span>
                                    <span
                                      className={`tag ${statusChipClass(entry.status)}`}
                                      title="Jira status (from story / last pull)"
                                    >
                                      {entry.status}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="mt-2 rounded-lg border border-white/40 bg-white/50 px-2 py-2 text-[13px] text-slate-600">
              Not on the roster (e.g. Unassigned). Add people on Resources to track capacity here.
            </p>
          )}

          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {pathname === "/resources" ? null : (
              <Link href="/resources" className="btn-primary px-2 py-1 text-[13px]" onClick={onClose}>
                Open Resources
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

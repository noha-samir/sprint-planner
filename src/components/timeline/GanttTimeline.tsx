"use client";

import { format } from "date-fns";
import { useMemo } from "react";
import { getCurrentStoryPhase } from "@/lib/scheduler/currentPhase";
import { schedule } from "@/lib/scheduler/engine";
import { storyPhasePlanFromTask } from "@/lib/scheduler/storyTimelineEntries";
import { thursdayReleaseChipLabel } from "@/lib/scheduler/types";
import { usePlannerStore } from "@/store/usePlannerStore";
import { StoryPhaseFlow } from "./StoryPhaseFlow";
import { safeStoryHref } from "@/lib/ui/safeStoryHref";

const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

const storyHref = safeStoryHref;

const fmtRelease = (date: Date) => format(date, "EEE dd MMM, h:mm a");

export function GanttTimeline() {
  const { result, tasks, resources, config, timelineStartDate } = usePlannerStore();
  const safeResult = useMemo(() => {
    if (result.tasks.length > 0 || tasks.length === 0) {
      return result;
    }
    return schedule(tasks, resources, config);
  }, [result, tasks, resources, config]);

  const visibleTasks = safeResult.tasks.filter((task) => {
    if (!timelineStartDate) return true;
    if (!task.releaseDate) return true;
    return asDate(task.releaseDate).getTime() >= new Date(timelineStartDate).getTime();
  });

  if (visibleTasks.length === 0) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-sm text-slate-500">
        No stories match the timeline filter.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visibleTasks.map((task) => {
        const thursdayLabel = thursdayReleaseChipLabel(task.thursdayReleaseScope);
        const sourceTask = tasks.find((item) => item.id === task.id);
        const currentPhase = getCurrentStoryPhase({
          ...task,
          replanFromStep: sourceTask?.replanFromStep,
        });
        const storyTitle = task.storyName || task.storyLink || task.id;
        const phasePlan = sourceTask ? storyPhasePlanFromTask(sourceTask) : null;

        return (
          <article
            key={task.id}
            className={`overflow-hidden rounded-2xl border shadow-sm ${
              task.isOverflow ? "border-red-300 bg-red-50/40" : "border-slate-200 bg-white"
            }`}
          >
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold text-slate-900">
                  {(() => {
                    const href = storyHref(task.storyLink);
                    return href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 underline hover:text-blue-900"
                    >
                      {storyTitle}
                    </a>
                    ) : (
                    storyTitle
                    );
                  })()}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                  <span className="rounded-md bg-white px-1.5 py-0.5 font-medium ring-1 ring-slate-200">
                    {task.status}
                  </span>
                  {task.poPriority != null ? <span>PO #{task.poPriority}</span> : null}
                  {thursdayLabel ? (
                    <span className="rounded-full bg-pink-100 px-2 py-0.5 font-medium text-pink-700">{thursdayLabel}</span>
                  ) : null}
                  {task.isOverflow ? (
                    <span className="font-semibold text-red-700">Overflow</span>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 text-right text-[11px]">
                <div className="font-medium uppercase tracking-wide text-slate-500">Release</div>
                <div className="font-semibold text-slate-800">
                  {task.releaseDate ? fmtRelease(asDate(task.releaseDate)) : "Pending"}
                </div>
              </div>
            </header>
            <div className="p-4">
              <StoryPhaseFlow task={task} currentPhase={currentPhase} phasePlan={phasePlan} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

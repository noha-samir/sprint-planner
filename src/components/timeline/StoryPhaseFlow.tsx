"use client";

import { Fragment } from "react";
import { format } from "date-fns";
import type { StoryPhase } from "@/lib/scheduler/currentPhase";
import {
  buildMergedStoryTimelineEntries,
  buildStoryPhaseFlowEntries,
  type StoryPhasePlan,
  type StoryTimelineEntry,
  type StoryTimelinePhase,
} from "@/lib/scheduler/storyTimelineEntries";
import type { ScheduledTask } from "@/lib/scheduler/types";

const phaseBoxClass: Record<StoryTimelinePhase, string> = {
  BE: "phase-be",
  FE: "phase-fe",
  Android: "phase-android",
  IOS: "phase-ios",
  Integration: "phase-int",
  QC: "phase-qc",
  Buffer: "phase-buffer",
};

const phaseShortLabel: Record<StoryTimelinePhase, string> = {
  BE: "Backend",
  FE: "Frontend",
  Android: "Android",
  IOS: "IOS",
  Integration: "Integration",
  QC: "QC",
  Buffer: "Buffer",
};

const fmtShort = (date: Date) => format(date, "dd MMM · h:mm a");

/** Show estimated / scheduled working hours — never calendar day spans. */
const hoursLabel = (hours: number | null | undefined): string => {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) {
    return "";
  }
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded}h`;
};

type StoryPhaseFlowProps = {
  task: ScheduledTask;
  currentPhase?: StoryPhase | null;
  entries?: StoryTimelineEntry[];
  /** Source task hours — keeps earlier steps visible when status advances. */
  phasePlan?: StoryPhasePlan | null;
};

export function StoryPhaseFlow({ task, currentPhase = null, entries, phasePlan = null }: StoryPhaseFlowProps) {
  const timelineEntries =
    entries ??
    (phasePlan
      ? buildStoryPhaseFlowEntries(task, phasePlan, currentPhase)
      : buildMergedStoryTimelineEntries(task));

  if (timelineEntries.length === 0) {
    return (
      <div className="story-phase-flow story-phase-flow-empty">
        <p className="text-center text-sm text-slate-500">No scheduled phases yet.</p>
      </div>
    );
  }

  return (
    <div className="story-phase-flow">
      <div className="story-phase-flow-track">
        {timelineEntries.map((entry, index) => {
          const isCurrent = currentPhase === (entry.phase as StoryPhase);
          const hasDates = entry.start != null && entry.end != null;
          const duration = hoursLabel(entry.hours) || (entry.completed ? "Done" : "");
          return (
            <Fragment key={entry.key}>
              {index > 0 ? <div className="story-phase-flow-connector" aria-hidden /> : null}
              <div
                className={`story-phase-flow-node ${phaseBoxClass[entry.phase]} ${
                  entry.completed ? "story-phase-flow-node-completed" : ""
                } ${isCurrent ? "phase-current" : ""}`}
                aria-current={isCurrent ? "step" : undefined}
              >
                <div className="story-phase-flow-node-head">
                  <span className="story-phase-flow-node-label">{phaseShortLabel[entry.phase]}</span>
                  {duration ? <span className="story-phase-flow-node-duration">{duration}</span> : null}
                </div>
                {entry.resourceName ? (
                  <div className="story-phase-flow-node-assignee" title={entry.resourceName}>
                    {entry.resourceName}
                  </div>
                ) : (
                  <div className="story-phase-flow-node-assignee story-phase-flow-node-assignee-muted">—</div>
                )}
                <div className="story-phase-flow-node-dates">
                  {hasDates ? (
                    <>
                      <time dateTime={entry.start!.toISOString()}>{fmtShort(entry.start!)}</time>
                      <span className="story-phase-flow-node-dates-sep">to</span>
                      <time dateTime={entry.end!.toISOString()}>{fmtShort(entry.end!)}</time>
                    </>
                  ) : (
                    <span className="story-phase-flow-node-dates-sep">
                      {entry.completed ? "Completed before current status" : "Pending schedule"}
                    </span>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

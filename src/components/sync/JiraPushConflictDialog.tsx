"use client";

import { format } from "date-fns";
import type { BulkSyncLeftOutStory } from "@/lib/integrations/jira/syncEligibility";

export type JiraPushConflictChoice = "pull" | "push" | "cancel";

export type JiraPushConflictStory = {
  taskId: string;
  storyName: string;
  keys: string[];
  latestUpdatedAt: string | null;
  neverPulled: boolean;
};

type Props = {
  eligibleCount: number;
  changed: JiraPushConflictStory[];
  leftOut: BulkSyncLeftOutStory[];
  onChoose: (choice: JiraPushConflictChoice) => void;
};

const formatUpdatedAt = (value: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : format(date, "dd MMM HH:mm");
};

/**
 * Asks before push when Jira has changes newer than our last pull/push (push would overwrite them).
 * Choices: pull the changed stories first, push anyway, or cancel.
 */
export function JiraPushConflictDialog({ eligibleCount, changed, leftOut, onChoose }: Props) {
  const neverPulled = changed.filter((story) => story.neverPulled);
  const updated = changed.filter((story) => !story.neverPulled);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(12vh,6rem)]"
      onClick={() => onChoose("cancel")}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="jira-push-conflict-title"
      >
        <h3 id="jira-push-conflict-title" className="text-lg font-semibold text-slate-900">
          Jira has changes you haven&apos;t pulled
        </h3>
        <p className="mt-1 text-[13px] text-slate-600">
          Pushing {eligibleCount === 1 ? "1 story" : `${eligibleCount} stories`} will overwrite status, hours, and
          assignees in Jira. Pull first to keep the Jira changes.
        </p>

        <div className="mt-3 max-h-[40vh] space-y-3 overflow-y-auto text-[13px]">
          {updated.length > 0 ? (
            <section>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                Changed in Jira since last pull ({updated.length})
              </div>
              <ul className="space-y-1">
                {updated.map((story) => (
                  <li key={story.taskId} className="text-slate-800">
                    <span className="font-semibold">{story.storyName}</span>
                    <span className="text-slate-500">
                      {" "}
                      — {story.keys.join(", ")}
                      {story.latestUpdatedAt ? ` · ${formatUpdatedAt(story.latestUpdatedAt)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {neverPulled.length > 0 ? (
            <section>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                Never pulled from Jira ({neverPulled.length})
              </div>
              <ul className="space-y-1">
                {neverPulled.map((story) => (
                  <li key={story.taskId} className="font-semibold text-slate-800">
                    {story.storyName}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {leftOut.length > 0 ? (
            <section>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                Skipped — not an error ({leftOut.length})
              </div>
              <ul className="space-y-1 text-slate-600">
                {leftOut.map((story) => (
                  <li key={`${story.name}-${story.reason}`}>
                    {story.name} — no Jira link
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-sm"
            title="Don't push anything"
            onClick={() => onChoose("cancel")}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-sm text-rose-700"
            title="Push the planner values and replace the newer edits in Jira"
            onClick={() => onChoose("push")}
          >
            Push anyway (overwrite Jira)
          </button>
          <button
            type="button"
            className="btn-primary px-3 py-1.5 text-sm"
            title="Bring the latest Jira changes into the planner first, then review before pushing"
            onClick={() => onChoose("pull")}
          >
            Pull {changed.length === 1 ? "this story" : "these stories"} first
          </button>
        </div>
      </div>
    </div>
  );
}

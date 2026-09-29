"use client";

import { useEffect, useState } from "react";
import { useJiraSyncStore } from "@/store/useJiraSyncStore";

const MAX_RUNNING_STORIES_SHOWN = 3;

const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const storiesLabel = (count: number): string => (count === 1 ? "1 story" : `${count} stories`);

/**
 * Full-screen loading screen while a Jira pull/push runs: preparing (searching / checking Jira),
 * syncing stories (progress + stories in flight), and saving the planner. Blocks the board so edits
 * made mid-sync cannot race the save. Hidden when nothing is running; the result banner takes over.
 */
export function JiraSyncLoadingScreen() {
  const active = useJiraSyncStore((state) => state.active);
  const preparing = useJiraSyncStore((state) => state.preparing);
  const busySince = useJiraSyncStore((state) => state.busySince);
  const phase = useJiraSyncStore((state) => state.phase);
  const storeMode = useJiraSyncStore((state) => state.mode);
  const total = useJiraSyncStore((state) => state.total);
  const completed = useJiraSyncStore((state) => state.completed);
  const tasks = useJiraSyncStore((state) => state.tasks);
  const [now, setNow] = useState(() => Date.now());

  const visible = active || preparing !== null;

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  const mode = preparing?.mode ?? storeMode;
  const saving = !preparing && phase === "saving";
  const okCount = tasks.filter((task) => task.status === "ok").length;
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  const running = tasks.filter((task) => task.status === "running");
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const indeterminate = preparing !== null || saving;

  const title = preparing
    ? preparing.title
    : saving
      ? "Saving planner…"
      : `${mode === "pull" ? "Pulling from Jira" : "Pushing to Jira"} — ${completed}/${total}`;

  return (
    <div className="jira-sync-loading-backdrop" role="presentation">
      <div
        className="jira-sync-loading-card"
        role="dialog"
        aria-busy="true"
        aria-modal="true"
        aria-labelledby="jira-sync-loading-title"
      >
        <div className="flex items-center gap-3">
          <span className="jira-sync-loading-spinner" aria-hidden />
          <h3 id="jira-sync-loading-title" className="min-w-0 flex-1 text-base font-semibold leading-snug">
            {title}
          </h3>
          {!preparing ? (
            <span className="shrink-0 text-[12px] font-semibold tabular-nums opacity-80">
              {okCount} ok · {failedCount} failed
            </span>
          ) : null}
        </div>

        <div className="jira-sync-banner-bar mt-3" aria-hidden>
          {indeterminate ? (
            <div className="jira-sync-banner-bar-indeterminate" />
          ) : (
            <div className="jira-sync-banner-bar-fill" style={{ width: `${percent}%` }} />
          )}
        </div>

        <div className="mt-3 text-[13px] leading-snug opacity-90" aria-live="polite">
          {preparing ? (
            <p>{preparing.detail}</p>
          ) : saving ? (
            <p>
              Writing the results of {storiesLabel(okCount)} to the server. Large planners can take up to a
              minute.
            </p>
          ) : running.length > 0 ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">Working on</p>
              <ul className="mt-1 space-y-1">
                {running.slice(0, MAX_RUNNING_STORIES_SHOWN).map((task) => (
                  <li key={task.taskId} className="jira-sync-loading-story" title={task.storyName}>
                    {task.storyName}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{completed < total ? "Starting next story…" : "Finishing…"}</p>
          )}
        </div>

        <p className="mt-4 text-[11px] tabular-nums opacity-70">
          {busySince ? `Elapsed ${formatElapsed(now - busySince)} · ` : ""}
          Please keep this tab open and don&apos;t refresh.
        </p>
      </div>
    </div>
  );
}

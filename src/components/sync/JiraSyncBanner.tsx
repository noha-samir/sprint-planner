"use client";

import { useEffect } from "react";
import type {
  BulkNotificationSummary,
  NotificationGroup,
  TextSegment,
} from "@/lib/integrations/jira/bulkNotificationFormat";
import { useJiraSyncStore } from "@/store/useJiraSyncStore";

const SUCCESS_BANNER_DISMISS_MS = 10_000;

const renderSegments = (segments: TextSegment[]) =>
  segments.map((segment, index) =>
    segment.emphasis ? (
      <strong key={`${segment.text}-${index}`}>{segment.text}</strong>
    ) : (
      <span key={`${segment.text}-${index}`}>{segment.text}</span>
    ),
  );

const SummaryGroups = ({ model }: { model: BulkNotificationSummary }) => {
  const errors = model.groups.filter((group) => group.severity === "error");
  const warnings = model.groups.filter((group) => group.severity === "warning");
  const info = model.groups.filter((group) => group.severity === "info");

  const renderSection = (title: string, groups: NotificationGroup[], className: string) => {
    if (groups.length === 0) return null;
    return (
      <div className={`jira-sync-banner-section ${className}`}>
        <div className="jira-sync-banner-section-title">{title}</div>
        <ul className="jira-sync-banner-groups">
          {groups.map((group, index) => (
            <li key={`${title}-${index}`} className="jira-sync-banner-group">
              <div className="jira-sync-banner-group-message">{renderSegments(group.segments)}</div>
              {group.stories.length > 0 ? (
                <div className="jira-sync-banner-stories">
                  {group.stories.map((story) => (
                    <span key={story} className="jira-sync-banner-story-chip" title={story}>
                      {story}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="jira-sync-banner-body">
      <p className="jira-sync-banner-headline">{model.headline}</p>
      {renderSection("Errors", errors, "jira-sync-banner-section-error")}
      {renderSection("Warnings", warnings, "jira-sync-banner-section-warning")}
      {info.length > 0 ? (
        <ul className="jira-sync-banner-groups jira-sync-banner-info">
          {info.map((group, index) => (
            <li key={`info-${index}`} className="jira-sync-banner-group">
              <div className="jira-sync-banner-group-message">{renderSegments(group.segments)}</div>
              {group.stories.length > 0 ? (
                <div className="jira-sync-banner-stories">
                  {group.stories.map((story) => (
                    <span key={story} className="jira-sync-banner-story-chip" title={story}>
                      {story}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

/**
 * App-wide Jira push/pull progress + completion summary.
 * Success auto-dismisses; errors and warnings stay until the user closes them.
 */
export function JiraSyncBanner() {
  const active = useJiraSyncStore((state) => state.active);
  const phase = useJiraSyncStore((state) => state.phase);
  const mode = useJiraSyncStore((state) => state.mode);
  const total = useJiraSyncStore((state) => state.total);
  const completed = useJiraSyncStore((state) => state.completed);
  const currentStoryName = useJiraSyncStore((state) => state.currentStoryName);
  const tasks = useJiraSyncStore((state) => state.tasks);
  const summary = useJiraSyncStore((state) => state.summary);
  const summaryModel = useJiraSyncStore((state) => state.summaryModel);
  const summaryIsError = useJiraSyncStore((state) => state.summaryIsError);
  const summaryIsWarning = useJiraSyncStore((state) => state.summaryIsWarning);
  const clearSummary = useJiraSyncStore((state) => state.clearSummary);

  useEffect(() => {
    if (active || !summary) {
      return;
    }
    const { summaryIsError: isError, summaryIsWarning: isWarning, clearSummary: dismiss } =
      useJiraSyncStore.getState();
    if (isError || isWarning) {
      return;
    }
    const timer = window.setTimeout(() => dismiss(), SUCCESS_BANNER_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [active, summary]);

  if (!active && !summary) {
    return null;
  }

  const doneVerb = mode === "pull" ? "Pull" : "Push";
  const okCount = tasks.filter((task) => task.status === "ok").length;
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const saving = phase === "saving";

  if (active) {
    return (
      <div
        className="jira-sync-banner jira-sync-banner-active"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="jira-sync-banner-head">
          <span className="jira-sync-banner-title">
            {saving
              ? "Saving planner…"
              : mode === "pull"
                ? "Pulling from Jira"
                : "Pushing to Jira"}
            {!saving ? ` — ${completed}/${total}` : ""}
          </span>
          <span className="jira-sync-banner-meta">
            {okCount} ok · {failedCount} failed · {saving ? "saving" : `${percent}%`}
          </span>
        </div>
        <div className="jira-sync-banner-bar" aria-hidden>
          <div
            className="jira-sync-banner-bar-fill"
            style={{ width: saving ? "100%" : `${percent}%` }}
          />
        </div>
        <p className="jira-sync-banner-current">
          {saving
            ? "Writing changes to the server…"
            : currentStoryName
              ? `Now: ${currentStoryName}`
              : completed < total
                ? "Starting next story…"
                : "Finishing…"}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`jira-sync-banner ${
        summaryIsError
          ? "jira-sync-banner-error"
          : summaryIsWarning
            ? "jira-sync-banner-warning"
            : "jira-sync-banner-done"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="jira-sync-banner-head">
        <span className="jira-sync-banner-title">
          {summaryIsError
            ? `${doneVerb} finished with errors`
            : summaryIsWarning
              ? `${doneVerb} finished with warnings`
              : `${doneVerb} finished`}
        </span>
        <button type="button" className="jira-sync-banner-dismiss" aria-label="Dismiss" onClick={clearSummary}>
          ×
        </button>
      </div>
      {summaryModel ? (
        <SummaryGroups model={summaryModel} />
      ) : (
        <p className="jira-sync-banner-summary">{summary}</p>
      )}
    </div>
  );
}

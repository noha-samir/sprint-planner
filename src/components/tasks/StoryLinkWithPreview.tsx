"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseJiraIssueKey } from "@/lib/integrations/jira/issueKey";
import type { JiraIssuePreview } from "@/lib/integrations/jira/issuePreview";
import { safeStoryHref } from "@/lib/ui/safeStoryHref";

const PREVIEW_OPEN_DELAY_MS = 400;
const PREVIEW_CLOSE_DELAY_MS = 180;

type CacheEntry = { status: "ok"; data: JiraIssuePreview };

const previewCache = new Map<string, CacheEntry>();

type StoryLinkWithPreviewProps = {
  href: string;
  label: string;
  storyLink: string;
  squadId: string | null;
  className?: string;
};

export function StoryLinkWithPreview({
  href,
  label,
  storyLink,
  squadId,
  className,
}: StoryLinkWithPreviewProps) {
  const issueKey = parseJiraIssueKey(storyLink);
  const canPreview = Boolean(issueKey && squadId && safeStoryHref(storyLink));
  const panelId = useId();
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<JiraIssuePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320, maxHeight: 360 });

  const clearOpenTimer = () => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const positionPanel = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const viewportH = window.innerHeight;
    const width = Math.min(340, Math.max(260, window.innerWidth - 24));
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    const spaceBelow = viewportH - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const measured = panelRef.current?.offsetHeight ?? 0;
    const estimated = measured > 0 ? measured : 280;
    const placeAbove = spaceBelow < estimated && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, placeAbove ? spaceAbove : spaceBelow);
    const usedHeight = Math.min(estimated, maxHeight);
    const top = placeAbove
      ? Math.max(margin, rect.top - gap - usedHeight)
      : rect.bottom + gap;
    setPos({ top, left, width, maxHeight });
  }, []);

  const loadPreview = useCallback(async () => {
    if (!issueKey || !squadId) return;
    const cached = previewCache.get(issueKey);
    if (cached?.status === "ok") {
      setPreview(cached.data);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/integrations/jira/issues/preview?issueKey=${encodeURIComponent(issueKey)}`,
        {
          headers: { "x-squad-id": squadId },
        },
      );
      const body = (await response.json()) as JiraIssuePreview & { error?: string };
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) {
        const message = body.error?.trim() || "Could not load Jira details.";
        setPreview(null);
        setError(message);
        return;
      }
      const data: JiraIssuePreview = {
        key: body.key || issueKey,
        summary: body.summary ?? "",
        assignee: body.assignee ?? "",
        reporter: body.reporter ?? "",
        descriptionPreview: body.descriptionPreview ?? "",
      };
      previewCache.set(issueKey, { status: "ok", data });
      setPreview(data);
      setError(null);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setPreview(null);
      setError("Could not load Jira details.");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [issueKey, squadId]);

  const showPanel = useCallback(() => {
    if (!canPreview) return;
    clearCloseTimer();
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      positionPanel();
      setOpen(true);
      void loadPreview();
    }, PREVIEW_OPEN_DELAY_MS);
  }, [canPreview, loadPreview, positionPanel]);

  const scheduleHide = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, PREVIEW_CLOSE_DELAY_MS);
  }, []);

  const keepOpen = useCallback(() => {
    clearCloseTimer();
  }, []);

  useEffect(() => {
    return () => {
      clearOpenTimer();
      clearCloseTimer();
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => positionPanel();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, positionPanel]);

  useEffect(() => {
    if (!open) return;
    positionPanel();
  }, [open, loading, preview, error, positionPanel]);

  return (
    <>
      <a
        ref={anchorRef}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        aria-describedby={open && canPreview ? panelId : undefined}
        onPointerEnter={showPanel}
        onPointerLeave={scheduleHide}
        onFocus={showPanel}
        onBlur={scheduleHide}
      >
        {label}
      </a>
      {open && canPreview && typeof document !== "undefined"
        ? createPortal(
            <div
              id={panelId}
              ref={panelRef}
              role="tooltip"
              className="story-link-preview"
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
                overflowY: "auto",
                zIndex: 1100,
              }}
              onPointerEnter={keepOpen}
              onPointerLeave={scheduleHide}
            >
              <div className="story-link-preview-header">
                <span className="story-link-preview-key">{issueKey}</span>
                {preview?.summary ? (
                  <span className="story-link-preview-summary">{preview.summary}</span>
                ) : null}
              </div>
              {loading && !preview && !error ? (
                <p className="story-link-preview-muted">Loading Jira details…</p>
              ) : null}
              {error ? <p className="story-link-preview-error">{error}</p> : null}
              {preview ? (
                <div className="story-link-preview-body">
                  <div className="story-link-preview-row">
                    <span className="story-link-preview-label">Reporter</span>
                    <span className="story-link-preview-value">{preview.reporter || "—"}</span>
                  </div>
                  <div className="story-link-preview-row">
                    <span className="story-link-preview-label">Assignee</span>
                    <span className="story-link-preview-value">{preview.assignee || "—"}</span>
                  </div>
                  <div className="story-link-preview-desc">
                    <span className="story-link-preview-label">Description</span>
                    <p className="story-link-preview-desc-text">
                      {preview.descriptionPreview || "No description"}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

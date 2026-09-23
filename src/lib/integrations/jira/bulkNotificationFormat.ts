/**
 * Shared formatting for Jira bulk push/pull notification summaries.
 */

export type StoryMessage = {
  story: string;
  message: string;
};

export type TextSegment = {
  text: string;
  emphasis?: boolean;
};

export type NotificationGroup = {
  severity: "error" | "warning" | "info";
  /** Short message with optional bold segments. */
  segments: TextSegment[];
  /** Stories that share this message (grouped). */
  stories: string[];
};

export type BulkNotificationSummary = {
  headline: string;
  groups: NotificationGroup[];
};

export type BulkSummaryResult = {
  model: BulkNotificationSummary;
  text: string;
};

const normalizeMessageKey = (message: string): string => message.trim().replace(/\s+/g, " ");

/**
 * True when the message means an intended update did not happen (banner = error, not warning).
 */
export function isActionFailureMessage(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (/was not updated/i.test(text)) return true;
  if (/not created\/updated/i.test(text)) return true;
  if (/Status sync failed/i.test(text)) return true;
  if (/Failed to (create|update|load|sync|read)/i.test(text)) return true;
  if (/is not on the Resources roster/i.test(text)) return true;
  if (/Parent Dev \d+(\.\d+)?h — no role subtasks/i.test(text)) return true;
  if (/but no \[FE\]\/\[BE\]\/\[Android\]\/\[IOS\] subtasks were found to apply it/i.test(text)) {
    return true;
  }
  if (/has \d+(\.\d+)?h on .+ but no assignee/i.test(text)) return true;
  return false;
}

const EMPHASIS_RE =
  /(\d+(?:\.\d+)?h)|\b(FE|BE|QC|Dev|Testing|Android|IOS|MO)\b|(no (?:FE |BE |Android |IOS |role )?subtasks?)|(no assignee)|(was not updated)|(not created\/updated)|(roster)/gi;

/**
 * Split a message into plain + emphasized segments for the banner.
 */
export function emphasizeMessage(message: string): TextSegment[] {
  const text = normalizeMessageKey(message);
  if (!text) return [];
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  EMPHASIS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMPHASIS_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    segments.push({ text: match[0], emphasis: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ text }];
}

export function segmentsToPlainText(segments: TextSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

/**
 * Group identical messages and list the stories they affect.
 */
export function groupStoryMessages(
  entries: StoryMessage[],
  severity: NotificationGroup["severity"],
): NotificationGroup[] {
  if (entries.length === 0) return [];

  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const message = normalizeMessageKey(entry.message);
    if (!message) continue;
    const story = entry.story.trim() || "Untitled";
    const stories = groups.get(message) ?? [];
    if (!stories.includes(story)) {
      stories.push(story);
    }
    groups.set(message, stories);
  }

  return [...groups.entries()].map(([message, stories]) => ({
    severity,
    segments: emphasizeMessage(message),
    stories,
  }));
}

/**
 * Group identical messages as plain text (tests / fallback).
 */
export function formatGroupedStoryMessages(entries: StoryMessage[]): string {
  return groupStoryMessages(entries, "info")
    .map((group) => {
      const message = segmentsToPlainText(group.segments);
      if (group.stories.length === 1) {
        return `• ${message}\n  — ${group.stories[0]}`;
      }
      return `• ${message}\n${group.stories.map((story) => `  — ${story}`).join("\n")}`;
    })
    .join("\n");
}

export function partitionMessages(entries: StoryMessage[]): {
  actionFailures: StoryMessage[];
  softWarnings: StoryMessage[];
} {
  const actionFailures: StoryMessage[] = [];
  const softWarnings: StoryMessage[] = [];
  for (const entry of entries) {
    if (isActionFailureMessage(entry.message)) {
      actionFailures.push(entry);
    } else {
      softWarnings.push(entry);
    }
  }
  return { actionFailures, softWarnings };
}

export const storyCountLabel = (count: number): string =>
  count === 1 ? "1 story" : `${count} stories`;

/**
 * Flatten a structured summary to plain text (tests / a11y).
 */
export function summaryToPlainText(model: BulkNotificationSummary): string {
  const lines: string[] = [model.headline];
  let currentSeverity: NotificationGroup["severity"] | null = null;

  for (const group of model.groups) {
    if (group.severity !== currentSeverity) {
      currentSeverity = group.severity;
      if (group.severity === "error") {
        lines.push("Errors:");
      } else if (group.severity === "warning") {
        lines.push("Warnings:");
      }
    }
    const message = segmentsToPlainText(group.segments);
    if (group.stories.length === 0) {
      lines.push(`• ${message}`);
    } else if (group.stories.length === 1) {
      lines.push(`• ${message}\n  — ${group.stories[0]}`);
    } else {
      lines.push(`• ${message}\n${group.stories.map((story) => `  — ${story}`).join("\n")}`);
    }
  }

  return lines.filter(Boolean).join("\n\n");
}

export function buildBulkSummaryResult(model: BulkNotificationSummary): BulkSummaryResult {
  return { model, text: summaryToPlainText(model) };
}

export function appendSummaryGroups(
  base: BulkNotificationSummary,
  extra: NotificationGroup[],
): BulkNotificationSummary {
  return { ...base, groups: [...base.groups, ...extra] };
}

export function mergeSummaryText(parts: Array<string | null | undefined>): string {
  return parts.filter((part) => Boolean(part && part.trim())).join("\n\n");
}

/**
 * Shared formatting for Jira bulk push/pull notification summaries.
 */

export type StoryMessage = {
  story: string;
  message: string;
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
  if (/but no \[FE\]\/\[BE\]\/\[Android\]\/\[IOS\] subtasks were found to apply it/i.test(text)) {
    return true;
  }
  if (/has \d+(\.\d+)?h on .+ but no assignee/i.test(text)) return true;
  return false;
}

/**
 * Group identical messages and list the stories they affect.
 *
 * Example:
 * • QC Engineer "X" … was not updated
 *   — Story A
 *   — Story B
 */
export function formatGroupedStoryMessages(entries: StoryMessage[]): string {
  if (entries.length === 0) return "";

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

  return [...groups.entries()]
    .map(([message, stories]) => {
      if (stories.length === 1) {
        return `• ${message}\n  — ${stories[0]}`;
      }
      return `• ${message}\n${stories.map((story) => `  — ${story}`).join("\n")}`;
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

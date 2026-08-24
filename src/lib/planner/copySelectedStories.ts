import { safeStoryHref } from "@/lib/ui/safeStoryHref";

export type StoryShareRow = {
  storyName?: string | null;
  storyLink?: string | null;
};

export type StoryShareClipboardPayload = {
  html: string;
  plain: string;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeMarkdownLinkLabel = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

/** Display label for a story when copying; empty names become Untitled. */
export const storyShareLabel = (storyName: string | null | undefined): string => {
  const trimmed = typeof storyName === "string" ? storyName.trim() : "";
  return trimmed || "Untitled";
};

/**
 * Build HTML + plain clipboard payloads so the story name is clickable when pasted.
 * HTML uses <a>; plain uses Markdown links. Stories without a safe link are plain text.
 */
export const formatSelectedStoriesForClipboard = (stories: StoryShareRow[]): StoryShareClipboardPayload => {
  const htmlParts: string[] = [];
  const plainParts: string[] = [];

  for (const story of stories) {
    const label = storyShareLabel(story.storyName);
    const href = safeStoryHref(typeof story.storyLink === "string" ? story.storyLink : "");

    if (href) {
      htmlParts.push(`<div><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></div>`);
      plainParts.push(`[${escapeMarkdownLinkLabel(label)}](${href})`);
    } else {
      htmlParts.push(`<div>${escapeHtml(label)}</div>`);
      plainParts.push(label);
    }
  }

  return {
    html: htmlParts.join(""),
    plain: plainParts.join("\n"),
  };
};

/**
 * Copy selected stories as clickable names (HTML + plain), falling back to plain text.
 */
export const copySelectedStoriesToClipboard = async (stories: StoryShareRow[]): Promise<void> => {
  const { html, plain } = formatSelectedStoriesForClipboard(stories);
  if (!plain && !html) {
    return;
  }

  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("Clipboard is not available");
  }

  try {
    if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return;
    }
  } catch {
    // Fall through to plain-text copy.
  }

  await navigator.clipboard.writeText(plain);
};

/**
 * Build a safe http(s) href for story links. Rejects javascript:/data:/etc.
 * Bare hosts get an https:// prefix.
 */
export const safeStoryHref = (raw: string): string => {
  const t = raw.trim();
  if (!t) return "";

  const candidate = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
};

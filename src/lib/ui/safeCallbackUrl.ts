/**
 * Allow only same-origin relative paths for post-auth redirects.
 * Rejects protocol-relative (`//evil.com`) and absolute URLs.
 */
export const safeCallbackUrl = (raw: string | null | undefined, fallback = "/"): string => {
  const value = (raw ?? "").trim();
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\") || value.includes("@")) return fallback;
  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost") return fallback;
    return `${url.pathname}${url.search}${url.hash}` || fallback;
  } catch {
    return fallback;
  }
};

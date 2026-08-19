export const COLOR_SCHEME_STORAGE_KEY = "sprint-planner:color-scheme";
export const COLOR_SCHEME_CLASS = "color-scheme-dark";

export type ColorScheme = "light" | "dark";

export const parseColorScheme = (value: string | null | undefined): ColorScheme | null =>
  value === "light" || value === "dark" ? value : null;

export const systemColorScheme = (): ColorScheme => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const readStoredColorScheme = (): ColorScheme | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return parseColorScheme(window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY));
  } catch {
    return null;
  }
};

export const resolveColorScheme = (): ColorScheme => readStoredColorScheme() ?? systemColorScheme();

export const persistColorScheme = (scheme: ColorScheme): void => {
  try {
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
  } catch {
    /* ignore quota / private mode */
  }
};

export const applyColorScheme = (scheme: ColorScheme): void => {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle(COLOR_SCHEME_CLASS, scheme === "dark");
  document.documentElement.style.colorScheme = scheme;
};

export const COLOR_SCHEME_STORAGE_KEY = "sprint-planner:color-scheme";
export const COLOR_SCHEME_CLASS = "color-scheme-dark";

export type ColorScheme = "light" | "dark";
export type ColorSchemePreference = ColorScheme | "system";

type PreferenceListener = (preference: ColorSchemePreference) => void;

const preferenceListeners = new Set<PreferenceListener>();

export const parseColorScheme = (value: string | null | undefined): ColorScheme | null =>
  value === "light" || value === "dark" ? value : null;

/** Missing, "system", and unknown values all mean follow the OS. */
export const storedColorSchemePreference = (value: string | null | undefined): ColorSchemePreference =>
  parseColorScheme(value) ?? "system";

export const systemColorScheme = (): ColorScheme => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const readStoredColorSchemePreference = (): ColorSchemePreference => {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    return storedColorSchemePreference(window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY));
  } catch {
    return "system";
  }
};

export const resolveAppliedColorScheme = (
  preference: ColorSchemePreference,
  systemScheme: ColorScheme = systemColorScheme(),
): ColorScheme => (preference === "system" ? systemScheme : preference);

/**
 * Light and dark are written. System removes the key so a later visit keeps following the OS.
 */
export const persistColorSchemePreference = (preference: ColorSchemePreference): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (preference === "system") {
      window.localStorage.removeItem(COLOR_SCHEME_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, preference);
  } catch {
    /* ignore quota / private mode */
  }
};

export const applyColorScheme = (scheme: ColorScheme): void => {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle(COLOR_SCHEME_CLASS, scheme === "dark");
};

export const subscribeColorSchemePreference = (listener: PreferenceListener): (() => void) => {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
};

export const commitColorSchemePreference = (preference: ColorSchemePreference): ColorScheme => {
  const scheme = resolveAppliedColorScheme(preference);
  applyColorScheme(scheme);
  preferenceListeners.forEach((listener) => listener(preference));
  return scheme;
};

/**
 * Applies the stored preference once, then updates with the OS only while that preference is system.
 * Does not write localStorage.
 */
export const bindSystemColorScheme = (): (() => void) => {
  commitColorSchemePreference(readStoredColorSchemePreference());

  const onSystemChange = () => {
    if (readStoredColorSchemePreference() !== "system") {
      return;
    }
    commitColorSchemePreference("system");
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== COLOR_SCHEME_STORAGE_KEY) {
      return;
    }
    commitColorSchemePreference(readStoredColorSchemePreference());
  };

  const media =
    typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  media?.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);

  return () => {
    media?.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
};

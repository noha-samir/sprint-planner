import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLOR_SCHEME_CLASS,
  COLOR_SCHEME_STORAGE_KEY,
  bindSystemColorScheme,
  commitColorSchemePreference,
  parseColorScheme,
  persistColorSchemePreference,
  readStoredColorSchemePreference,
  resolveAppliedColorScheme,
  storedColorSchemePreference,
  subscribeColorSchemePreference,
  systemColorScheme,
} from "./colorScheme";

describe("parseColorScheme", () => {
  it("accepts light and dark only", () => {
    expect(parseColorScheme("light")).toBe("light");
    expect(parseColorScheme("dark")).toBe("dark");
    expect(parseColorScheme("ocean")).toBeNull();
    expect(parseColorScheme("system")).toBeNull();
    expect(parseColorScheme("")).toBeNull();
    expect(parseColorScheme(null)).toBeNull();
  });
});

describe("storedColorSchemePreference", () => {
  it("treats anything other than light or dark as system", () => {
    expect(storedColorSchemePreference("light")).toBe("light");
    expect(storedColorSchemePreference("dark")).toBe("dark");
    expect(storedColorSchemePreference("system")).toBe("system");
    expect(storedColorSchemePreference(null)).toBe("system");
    expect(storedColorSchemePreference("")).toBe("system");
    expect(storedColorSchemePreference("ocean")).toBe("system");
  });
});

describe("resolveAppliedColorScheme", () => {
  it("uses the OS scheme only for system", () => {
    expect(resolveAppliedColorScheme("system", "dark")).toBe("dark");
    expect(resolveAppliedColorScheme("system", "light")).toBe("light");
    expect(resolveAppliedColorScheme("light", "dark")).toBe("light");
    expect(resolveAppliedColorScheme("dark", "light")).toBe("dark");
  });
});

describe("color scheme storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const installStorage = () => {
    const values = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    vi.stubGlobal("window", { localStorage, matchMedia: undefined });
    return localStorage;
  };

  it("persists light and dark and clears the key for system", () => {
    const localStorage = installStorage();

    persistColorSchemePreference("dark");
    expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredColorSchemePreference()).toBe("dark");

    persistColorSchemePreference("light");
    expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe("light");

    persistColorSchemePreference("system");
    expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBeNull();
    expect(readStoredColorSchemePreference()).toBe("system");
  });

  it("keeps system when storage throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });

    expect(readStoredColorSchemePreference()).toBe("system");
    expect(() => persistColorSchemePreference("dark")).not.toThrow();
    expect(readStoredColorSchemePreference()).toBe("system");
  });
});

describe("bindSystemColorScheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows OS changes until an explicit choice is stored", () => {
    let matches = false;
    const mediaListeners = new Set<() => void>();
    const storageListeners = new Set<(event: StorageEvent) => void>();
    const values = new Map<string, string>();
    const toggle = vi.fn();

    vi.stubGlobal("document", {
      documentElement: { classList: { toggle } },
    });
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
      matchMedia: () => ({
        get matches() {
          return matches;
        },
        addEventListener: (_type: string, listener: () => void) => {
          mediaListeners.add(listener);
        },
        removeEventListener: (_type: string, listener: () => void) => {
          mediaListeners.delete(listener);
        },
      }),
      addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === "storage") storageListeners.add(listener);
      },
      removeEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === "storage") storageListeners.delete(listener);
      },
    });

    const unbind = bindSystemColorScheme();
    expect(toggle).toHaveBeenLastCalledWith(COLOR_SCHEME_CLASS, false);
    expect(values.size).toBe(0);

    matches = true;
    mediaListeners.forEach((listener) => listener());
    expect(toggle).toHaveBeenLastCalledWith(COLOR_SCHEME_CLASS, true);
    expect(values.get(COLOR_SCHEME_STORAGE_KEY)).toBeUndefined();

    persistColorSchemePreference("light");
    commitColorSchemePreference("light");
    expect(toggle).toHaveBeenLastCalledWith(COLOR_SCHEME_CLASS, false);

    matches = true;
    mediaListeners.forEach((listener) => listener());
    expect(toggle).toHaveBeenLastCalledWith(COLOR_SCHEME_CLASS, false);
    expect(readStoredColorSchemePreference()).toBe("light");

    values.set(COLOR_SCHEME_STORAGE_KEY, "dark");
    storageListeners.forEach((listener) =>
      listener({ key: COLOR_SCHEME_STORAGE_KEY } as StorageEvent),
    );
    expect(toggle).toHaveBeenLastCalledWith(COLOR_SCHEME_CLASS, true);
    expect(systemColorScheme()).toBe("dark");

    unbind();
    matches = false;
    mediaListeners.forEach((listener) => listener());
    expect(toggle).toHaveBeenLastCalledWith(COLOR_SCHEME_CLASS, true);
  });

  it("notifies subscribers without writing storage on OS changes", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeColorSchemePreference((preference) => seen.push(preference));
    commitColorSchemePreference("system");
    expect(seen).toEqual(["system"]);
    unsubscribe();
    commitColorSchemePreference("dark");
    expect(seen).toEqual(["system"]);
  });
});

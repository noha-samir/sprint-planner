"use client";

import { useColorScheme } from "@/lib/ui/useColorScheme";

export function AppearanceToggle() {
  const { scheme, setScheme } = useColorScheme();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-800">Appearance</legend>
      <p className="text-[13px] text-slate-500">
        Personal light or dark theme. Saved on this device; it does not change the squad calendar.
      </p>
      <div className="appearance-toggle">
        <button
          type="button"
          className={`appearance-toggle-btn${scheme === "light" ? " appearance-toggle-btn-on" : ""}`}
          aria-pressed={scheme === "light"}
          onClick={() => setScheme("light")}
        >
          Light
        </button>
        <button
          type="button"
          className={`appearance-toggle-btn${scheme === "dark" ? " appearance-toggle-btn-on" : ""}`}
          aria-pressed={scheme === "dark"}
          onClick={() => setScheme("dark")}
        >
          Dark
        </button>
      </div>
    </fieldset>
  );
}

"use client";

import { useColorScheme } from "@/lib/ui/useColorScheme";
import type { ColorSchemePreference } from "@/lib/ui/colorScheme";

const OPTIONS: { value: ColorSchemePreference; label: string; icon: "system" | "light" | "dark" }[] = [
  { value: "system", label: "System", icon: "system" },
  { value: "light", label: "Light", icon: "light" },
  { value: "dark", label: "Dark", icon: "dark" },
];

function AppearanceIcon({ name }: { name: "system" | "light" | "dark" }) {
  if (name === "light") {
    return (
      <svg className="sidebar-appearance-icon" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === "dark") {
    return (
      <svg className="sidebar-appearance-icon" viewBox="0 0 16 16" aria-hidden>
        <path
          d="M10.6 2.2a5.6 5.6 0 1 0 3.2 9.4A5.2 5.2 0 0 1 10.6 2.2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg className="sidebar-appearance-icon" viewBox="0 0 16 16" aria-hidden>
      <rect x="2.2" y="3" width="11.6" height="8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.2 13.2h3.6M8 11v2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function AppearanceToggle() {
  const { preference, setPreference } = useColorScheme();
  return (
    <section className="sidebar-appearance" aria-label="Appearance">
      <span className="sidebar-appearance-label">Appearance</span>
      <div className="sidebar-appearance-options" role="group" aria-label="Color mode">
        {OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`sidebar-appearance-option${selected ? " sidebar-appearance-option-on" : ""}`}
              aria-pressed={selected}
              title={
                option.value === "system"
                  ? "Follow this device. Does not change the squad calendar."
                  : "Saved on this device. Does not change the squad calendar."
              }
              onClick={() => setPreference(option.value)}
            >
              <AppearanceIcon name={option.icon} />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

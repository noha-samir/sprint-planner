"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  bindSystemColorScheme,
  commitColorSchemePreference,
  persistColorSchemePreference,
  readStoredColorSchemePreference,
  subscribeColorSchemePreference,
  type ColorSchemePreference,
} from "@/lib/ui/colorScheme";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ColorSchemeBoot() {
  useIsoLayoutEffect(() => bindSystemColorScheme(), []);
  return null;
}

export function useColorScheme(): {
  preference: ColorSchemePreference;
  setPreference: (preference: ColorSchemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ColorSchemePreference>("system");

  useIsoLayoutEffect(() => {
    setPreferenceState(readStoredColorSchemePreference());
    return subscribeColorSchemePreference(setPreferenceState);
  }, []);

  const setPreference = useCallback((next: ColorSchemePreference) => {
    persistColorSchemePreference(next);
    commitColorSchemePreference(next);
  }, []);

  return { preference, setPreference };
}

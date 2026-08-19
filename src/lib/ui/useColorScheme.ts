"use client";

import { useCallback, useEffect, useState } from "react";
import {
  applyColorScheme,
  persistColorScheme,
  resolveColorScheme,
  type ColorScheme,
} from "@/lib/ui/colorScheme";

export function useColorScheme(): {
  scheme: ColorScheme;
  setScheme: (scheme: ColorScheme) => void;
} {
  const [scheme, setSchemeState] = useState<ColorScheme>("light");

  useEffect(() => {
    const next = resolveColorScheme();
    setSchemeState(next);
    applyColorScheme(next);
  }, []);

  const setScheme = useCallback((next: ColorScheme) => {
    persistColorScheme(next);
    applyColorScheme(next);
    setSchemeState(next);
  }, []);

  return { scheme, setScheme };
}

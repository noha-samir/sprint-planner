"use client";

import { useEffect, useRef, useState } from "react";
import {
  HOVER_HINT_DELAY_MS,
  readHoverHintTarget,
  restoreNativeTitle,
  stashNativeTitle,
} from "@/lib/ui/hoverHint";

type HintState = {
  text: string;
  x: number;
  y: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Delayed explanation for any element with a `title`.
 * Native browser titles are suppressed so the hint only appears after a short pause.
 */
export function HoverHintLayer() {
  const [hint, setHint] = useState<HintState | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number>(0);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = 0;
      }
    };

    const hide = () => {
      clearTimer();
      const active = activeRef.current;
      if (active) {
        restoreNativeTitle(active);
        activeRef.current = null;
      }
      setHint(null);
    };

    const onPointerOver = (event: PointerEvent) => {
      const found = readHoverHintTarget(event.target);
      if (!found) {
        hide();
        return;
      }
      if (activeRef.current === found.element) {
        return;
      }
      hide();
      activeRef.current = found.element;
      stashNativeTitle(found.element, found.text);
      timerRef.current = window.setTimeout(() => {
        const rect = found.element.getBoundingClientRect();
        const width = Math.min(288, window.innerWidth - 16);
        const x = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
        const spaceBelow = window.innerHeight - rect.bottom;
        const y =
          spaceBelow < 72
            ? clamp(rect.top - 8, 8, window.innerHeight - 8)
            : clamp(rect.bottom + 8, 8, window.innerHeight - 8);
        setHint({ text: found.text, x, y });
      }, HOVER_HINT_DELAY_MS);
    };

    const onPointerOut = (event: PointerEvent) => {
      const active = activeRef.current;
      if (!active) {
        return;
      }
      const next = event.relatedTarget;
      if (next instanceof Node && active.contains(next)) {
        return;
      }
      hide();
    };

    const onScroll = () => hide();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      hide();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (!hint) {
    return null;
  }

  return (
    <div className="hover-hint" role="tooltip" style={{ left: hint.x, top: hint.y }}>
      {hint.text}
    </div>
  );
}

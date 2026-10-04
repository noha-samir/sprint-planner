"use client";

import { useEffect, useRef, useState } from "react";
import {
  computeHoverHintPosition,
  HOVER_HINT_DELAY_MS,
  HOVER_HINT_MENU_SELECTOR,
  readHoverHintTarget,
  restoreNativeTitle,
  stashNativeTitle,
  type HoverHintPosition,
} from "@/lib/ui/hoverHint";

type HintState = HoverHintPosition & { text: string };

const placementTransform: Record<HoverHintPosition["placement"], string | undefined> = {
  below: undefined,
  right: undefined,
  above: "translateY(-100%)",
  left: "translateX(-100%)",
};

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
        const menu = found.element.closest(HOVER_HINT_MENU_SELECTOR);
        const position = computeHoverHintPosition(
          found.element.getBoundingClientRect(),
          menu ? menu.getBoundingClientRect() : null,
          { width: window.innerWidth, height: window.innerHeight },
        );
        setHint({ text: found.text, ...position });
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
    <div
      className="hover-hint"
      role="tooltip"
      style={{ left: hint.x, top: hint.y, transform: placementTransform[hint.placement] }}
    >
      {hint.text}
    </div>
  );
}

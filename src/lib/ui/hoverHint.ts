export const HOVER_HINT_DELAY_MS = 400;

const HINT_ATTR = "data-hover-hint";

/** Dropdown containers whose item hints open beside the list instead of covering it. */
export const HOVER_HINT_MENU_SELECTOR = '[role="menu"], [role="listbox"], .toolbar-dropdown-shell';

const HINT_MAX_WIDTH = 288;
const HINT_GAP = 8;
const HINT_EDGE = 8;
const HINT_MIN_SPACE_BELOW = 72;

export type HoverHintPlacement = "below" | "above" | "right" | "left";

export type HoverHintRect = Pick<DOMRect, "top" | "bottom" | "left" | "right">;

export type HoverHintPosition = { x: number; y: number; placement: HoverHintPlacement };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Where to draw a hover hint. Items inside a dropdown get the hint beside the dropdown
 * (right, or left when the right side has no room) so it never covers the other items;
 * everything else gets it below, or above when there is no space below.
 * @param target - Bounding rect of the hovered element.
 * @param menu - Bounding rect of the enclosing dropdown, or null when not in one.
 * @param viewport - Window size.
 * @returns Anchor point plus placement; "above"/"left" anchors are the hint's bottom/right edge.
 */
export const computeHoverHintPosition = (
  target: HoverHintRect,
  menu: HoverHintRect | null,
  viewport: { width: number; height: number },
): HoverHintPosition => {
  const width = Math.min(HINT_MAX_WIDTH, viewport.width - HINT_EDGE * 2);

  if (menu) {
    const y = clamp(target.top, HINT_EDGE, Math.max(HINT_EDGE, viewport.height - HINT_MIN_SPACE_BELOW));
    if (menu.right + HINT_GAP + width <= viewport.width - HINT_EDGE) {
      return { x: menu.right + HINT_GAP, y, placement: "right" };
    }
    if (menu.left - HINT_GAP - width >= HINT_EDGE) {
      return { x: menu.left - HINT_GAP, y, placement: "left" };
    }
  }

  const x = clamp(target.left, HINT_EDGE, Math.max(HINT_EDGE, viewport.width - width - HINT_EDGE));
  if (viewport.height - target.bottom < HINT_MIN_SPACE_BELOW) {
    return { x, y: clamp(target.top - HINT_GAP, HINT_EDGE, viewport.height - HINT_EDGE), placement: "above" };
  }
  return { x, y: clamp(target.bottom + HINT_GAP, HINT_EDGE, viewport.height - HINT_EDGE), placement: "below" };
};

export const readHoverHintTarget = (
  target: EventTarget | null,
): { element: HTMLElement; text: string } | null => {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return null;
  }
  const element = target.closest(`[title], [${HINT_ATTR}]`);
  if (!(element instanceof HTMLElement)) {
    return null;
  }
  const text = (element.getAttribute("title") || element.getAttribute(HINT_ATTR) || "").trim();
  if (!text) {
    return null;
  }
  return { element, text };
};

export const stashNativeTitle = (element: HTMLElement, text: string): void => {
  if (!element.getAttribute(HINT_ATTR)) {
    element.setAttribute(HINT_ATTR, text);
  }
  element.removeAttribute("title");
};

export const restoreNativeTitle = (element: HTMLElement): void => {
  const text = element.getAttribute(HINT_ATTR);
  if (text) {
    element.setAttribute("title", text);
  }
  element.removeAttribute(HINT_ATTR);
};

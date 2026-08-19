export const HOVER_HINT_DELAY_MS = 1500;

const HINT_ATTR = "data-hover-hint";

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

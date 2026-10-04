import { describe, expect, it } from "vitest";
import { computeHoverHintPosition, readHoverHintTarget, restoreNativeTitle, stashNativeTitle } from "./hoverHint";

const viewport = { width: 1400, height: 900 };
const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("computeHoverHintPosition", () => {
  it("places dropdown item hints to the right of the dropdown, level with the item", () => {
    expect(computeHoverHintPosition(rect(110, 300, 290, 330), rect(100, 200, 300, 600), viewport)).toEqual({
      x: 308,
      y: 300,
      placement: "right",
    });
  });

  it("falls back to the left of the dropdown when the right side has no room", () => {
    expect(computeHoverHintPosition(rect(1110, 300, 1290, 330), rect(1100, 200, 1300, 600), viewport)).toEqual({
      x: 1092,
      y: 300,
      placement: "left",
    });
  });

  it("keeps regular hints below the element, or above when near the bottom", () => {
    expect(computeHoverHintPosition(rect(50, 100, 150, 130), null, viewport)).toEqual({
      x: 50,
      y: 138,
      placement: "below",
    });
    expect(computeHoverHintPosition(rect(50, 850, 150, 880), null, viewport).placement).toBe("above");
  });
});

describe("readHoverHintTarget", () => {
  it("returns null when there is no titled ancestor", () => {
    expect(readHoverHintTarget(null)).toBeNull();
  });
});

describe("stashNativeTitle", () => {
  it("moves title onto data-hover-hint so the browser does not show it immediately", () => {
    const element = {
      attrs: { title: "Pull from Jira" } as Record<string, string>,
      getAttribute(name: string) {
        return this.attrs[name] ?? null;
      },
      setAttribute(name: string, value: string) {
        this.attrs[name] = value;
      },
      removeAttribute(name: string) {
        delete this.attrs[name];
      },
    } as unknown as HTMLElement;

    stashNativeTitle(element, "Pull from Jira");
    expect(element.getAttribute("title")).toBeNull();
    expect(element.getAttribute("data-hover-hint")).toBe("Pull from Jira");
    restoreNativeTitle(element);
    expect(element.getAttribute("title")).toBe("Pull from Jira");
    expect(element.getAttribute("data-hover-hint")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { readHoverHintTarget, restoreNativeTitle, stashNativeTitle } from "./hoverHint";

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

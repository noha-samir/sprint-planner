import { describe, expect, it } from "vitest";
import { formatSelectedStoriesForClipboard, storyShareLabel } from "./copySelectedStories";

describe("copySelectedStories", () => {
  it("uses Untitled when the story name is blank", () => {
    expect(storyShareLabel("")).toBe("Untitled");
    expect(storyShareLabel("   ")).toBe("Untitled");
    expect(storyShareLabel(null)).toBe("Untitled");
  });

  it("formats name+link as clickable HTML and Markdown plain", () => {
    const payload = formatSelectedStoriesForClipboard([
      { storyName: "Pricing", storyLink: "https://jira.example/browse/ABC-1" },
      { storyName: "Checkout", storyLink: "https://jira.example/browse/ABC-2" },
    ]);

    expect(payload.html).toBe(
      '<div><a href="https://jira.example/browse/ABC-1">Pricing</a></div>' +
        '<div><a href="https://jira.example/browse/ABC-2">Checkout</a></div>',
    );
    expect(payload.plain).toBe(
      "[Pricing](https://jira.example/browse/ABC-1)\n[Checkout](https://jira.example/browse/ABC-2)",
    );
  });

  it("includes name-only rows when there is no safe link", () => {
    const payload = formatSelectedStoriesForClipboard([
      { storyName: "No link yet", storyLink: "" },
      { storyName: "Bad link", storyLink: "javascript:alert(1)" },
    ]);

    expect(payload.html).toBe("<div>No link yet</div><div>Bad link</div>");
    expect(payload.plain).toBe("No link yet\nBad link");
  });

  it("escapes HTML special characters in names and hrefs", () => {
    const payload = formatSelectedStoriesForClipboard([
      {
        storyName: `A <B> & "C"`,
        storyLink: 'https://jira.example/browse/ABC-1?q="x"&y=1',
      },
    ]);

    expect(payload.html).toContain("A &lt;B&gt; &amp; &quot;C&quot;");
    expect(payload.html).toContain('href="https://jira.example/browse/ABC-1?q=%22x%22&amp;y=1"');
    expect(payload.plain).toBe(`[A <B> & "C"](https://jira.example/browse/ABC-1?q=%22x%22&y=1)`);
  });

  it("escapes Markdown brackets in plain labels", () => {
    const payload = formatSelectedStoriesForClipboard([
      { storyName: "Foo [bar]", storyLink: "https://jira.example/browse/ABC-1" },
    ]);
    expect(payload.plain).toBe("[Foo \\[bar\\]](https://jira.example/browse/ABC-1)");
  });
});

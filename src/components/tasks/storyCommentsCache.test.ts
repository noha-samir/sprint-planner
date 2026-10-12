import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cachedStoryComments,
  fetchStoryComments,
  isStoryCommentsFresh,
  prefetchStoryComments,
  storeStoryComments,
} from "./storyCommentsCache";

const list = { total: 1, comments: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storyCommentsCache", () => {
  it("shares one request between concurrent loads and caches the result", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(list), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      fetchStoryComments("BR-1", "ventures"),
      fetchStoryComments("BR-1", "ventures"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(list);
    expect(second).toEqual(list);
    expect(cachedStoryComments("BR-1")).toEqual(list);
    expect(isStoryCommentsFresh("BR-1")).toBe(true);
  });

  it("skips prefetching a story fetched moments ago", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(list), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchStoryComments("BR-2", "ventures");

    prefetchStoryComments("BR-2", "ventures");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a sign-in hint on 401 and does not cache failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "No Jira token." }), { status: 401 })),
    );

    const result = await fetchStoryComments("BR-3", "ventures");

    expect(result).toEqual({ error: expect.stringContaining("sign in again") });
    expect(cachedStoryComments("BR-3")).toBeNull();
  });

  it("keeps local edits without marking them as freshly fetched", () => {
    storeStoryComments("BR-4", list);
    expect(cachedStoryComments("BR-4")).toEqual(list);
    expect(isStoryCommentsFresh("BR-4")).toBe(false);
  });
});

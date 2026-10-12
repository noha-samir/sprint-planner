import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addIssueComment,
  buildCommentAdf,
  commentAdfToDraft,
  deleteIssueComment,
  listIssueComments,
  toJiraIssueComment,
} from "./comments";
import { JiraApiError } from "./jiraErrors";

const credentials = { siteUrl: "https://example.atlassian.net", email: "me@example.com", apiToken: "token" };
const ali = { accountId: "acc-ali", displayName: "Ali" };
const aliHassan = { accountId: "acc-ali-h", displayName: "Ali Hassan" };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildCommentAdf", () => {
  it("turns picked @names into mention nodes and keeps the rest as text", () => {
    const adf = buildCommentAdf("Hi @Ali please check", [ali]);
    expect(adf).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hi " },
            { type: "mention", attrs: { id: "acc-ali", text: "@Ali" } },
            { type: "text", text: " please check" },
          ],
        },
      ],
    });
  });

  it("joins lines with hard breaks", () => {
    const paragraph = buildCommentAdf("line one\r\nline two", []).content?.[0];
    expect(paragraph?.content).toEqual([
      { type: "text", text: "line one" },
      { type: "hardBreak" },
      { type: "text", text: "line two" },
    ]);
  });

  it("prefers the longest name when one name is a prefix of another", () => {
    const nodes = buildCommentAdf("@Ali Hassan and @Ali", [ali, aliHassan]).content?.[0].content;
    expect(nodes).toEqual([
      { type: "mention", attrs: { id: "acc-ali-h", text: "@Ali Hassan" } },
      { type: "text", text: " and " },
      { type: "mention", attrs: { id: "acc-ali", text: "@Ali" } },
    ]);
  });

  it("does not mention when the name continues into another word or was edited", () => {
    const nodes = buildCommentAdf("@Alia and @Al", [ali]).content?.[0].content;
    expect(nodes).toEqual([{ type: "text", text: "@Alia and @Al" }]);
  });
});

describe("commentAdfToDraft", () => {
  it("round-trips text and mentions built by buildCommentAdf", () => {
    const text = "Hi @Ali Hassan\nsecond line @Ali";
    const draft = commentAdfToDraft(buildCommentAdf(text, [ali, aliHassan]));
    expect(draft.text).toBe(text);
    expect(draft.mentions).toEqual([aliHassan, ali]);
  });

  it("reads Jira mentions stored without the @ and dedupes repeated people", () => {
    const draft = commentAdfToDraft({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "acc-1", text: "Sara" } },
            { type: "text", text: " ping " },
            { type: "mention", attrs: { id: "acc-1", text: "@Sara" } },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "next" }] },
      ],
    });
    expect(draft).toEqual({ text: "@Sara ping @Sara\nnext", mentions: [{ accountId: "acc-1", displayName: "Sara" }] });
  });

  it("keeps plain string bodies", () => {
    expect(commentAdfToDraft("  old comment ")).toEqual({ text: "old comment", mentions: [] });
  });
});

describe("toJiraIssueComment", () => {
  const raw = {
    id: "10",
    author: { accountId: "me", displayName: "Me" },
    body: "hello",
    created: "2026-10-01T10:00:00.000+0000",
    updated: "2026-10-01T10:00:00.000+0000",
  };

  it("marks own comments only when the author is the signed-in user", () => {
    expect(toJiraIssueComment(raw, "me").isOwn).toBe(true);
    expect(toJiraIssueComment(raw, "someone-else").isOwn).toBe(false);
    expect(toJiraIssueComment(raw, null).isOwn).toBe(false);
  });

  it("flags edited comments", () => {
    expect(toJiraIssueComment(raw, "me").edited).toBe(false);
    expect(toJiraIssueComment({ ...raw, updated: "2026-10-01T11:00:00.000+0000" }, "me").edited).toBe(true);
  });
});

describe("Jira comment API calls", () => {
  it("lists newest comments and marks the signed-in user's own", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/myself")
        ? jsonResponse({ accountId: "me" })
        : jsonResponse({
            total: 120,
            comments: [
              { id: "2", author: { accountId: "me", displayName: "Me" }, body: "mine" },
              { id: "1", author: { accountId: "other", displayName: "Other" }, body: "theirs" },
            ],
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listIssueComments(credentials, "BR-1");

    expect(result.total).toBe(120);
    expect(result.comments.map((comment) => [comment.id, comment.isOwn])).toEqual([
      ["2", true],
      ["1", false],
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/issue/BR-1/comment?orderBy=-created&maxResults=50"),
      expect.anything(),
    );
  });

  it("skips /myself when the signed-in account id is already known", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ total: 1, comments: [{ id: "3", author: { accountId: "me", displayName: "Me" }, body: "x" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listIssueComments(credentials, "BR-1", "me");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.comments[0].isOwn).toBe(true);
  });

  it("posts an ADF body and returns the created comment as own", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ id: "5", author: { accountId: "me", displayName: "Me" }, body: buildCommentAdf("@Ali hi", [ali]) }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const comment = await addIssueComment(credentials, "BR-1", { text: "@Ali hi", mentions: [ali] });

    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1].method).toBe("POST");
    expect(JSON.parse(String(init[1].body)).body.content[0].content[0]).toEqual({
      type: "mention",
      attrs: { id: "acc-ali", text: "@Ali" },
    });
    expect(comment).toMatchObject({ id: "5", isOwn: true, text: "@Ali hi", mentions: [ali] });
  });

  it("throws a JiraApiError with Jira's status when the delete is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    await expect(deleteIssueComment(credentials, "BR-1", "9")).rejects.toMatchObject({ status: 403 });
    await expect(deleteIssueComment(credentials, "BR-1", "9")).rejects.toBeInstanceOf(JiraApiError);
  });
});

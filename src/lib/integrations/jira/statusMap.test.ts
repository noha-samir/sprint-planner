import { describe, expect, it, vi, beforeEach } from "vitest";
import { isSameJiraStatus, pickTransitionForTargetStatus } from "./statusMap";
import { pushPlannerStatusToJira } from "./syncIssueStatus";
import * as client from "./client";

describe("statusMap", () => {
  it("matches current and target status names", () => {
    expect(isSameJiraStatus("To Do", "to do")).toBe(true);
    expect(isSameJiraStatus("Testing", "UAT")).toBe(false);
  });

  it("picks transition by destination status", () => {
    const picked = pickTransitionForTargetStatus(
      [
        { id: "1", name: "Start", toStatusName: "In Progress" },
        { id: "2", name: "Ship", toStatusName: "Production" },
      ],
      "Production",
    );
    expect(picked?.id).toBe("2");
  });
});

describe("pushPlannerStatusToJira", () => {
  const credentials = { siteUrl: "https://test.atlassian.net", email: "a@b.co", apiToken: "x" };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("no-ops when Jira is already on the target status", async () => {
    vi.spyOn(client, "getJiraIssueStatusName").mockResolvedValue("Testing");
    const transition = vi.spyOn(client, "transitionJiraIssue");
    const result = await pushPlannerStatusToJira(credentials, "BR-1", "Testing");
    expect(result.changed).toBe(false);
    expect(transition).not.toHaveBeenCalled();
  });

  it("transitions when a matching destination is available", async () => {
    vi.spyOn(client, "getJiraIssueStatusName").mockResolvedValue("To Do");
    vi.spyOn(client, "listJiraIssueTransitions").mockResolvedValue([
      { id: "71", name: "Start Progress", toStatusName: "In Progress" },
    ]);
    const transition = vi.spyOn(client, "transitionJiraIssue").mockResolvedValue(undefined);

    const result = await pushPlannerStatusToJira(credentials, "BR-1", "In Progress");
    expect(result.changed).toBe(true);
    expect(transition).toHaveBeenCalledWith(credentials, "BR-1", "71");
  });

  it("warns when the target status is not reachable", async () => {
    vi.spyOn(client, "getJiraIssueStatusName").mockResolvedValue("Testing");
    vi.spyOn(client, "listJiraIssueTransitions").mockResolvedValue([
      { id: "81", name: "Rejected", toStatusName: "To Do" },
    ]);
    const result = await pushPlannerStatusToJira(credentials, "BR-1", "UAT");
    expect(result.changed).toBe(false);
    expect(result.warning).toContain("Could not move BR-1");
  });
});

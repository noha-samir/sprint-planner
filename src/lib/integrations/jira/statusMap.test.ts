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

  it("steps To Do → In Progress → Ready for Review → Ready for Testing when there is no direct transition", async () => {
    vi.spyOn(client, "getJiraIssueStatusName").mockResolvedValue("To Do");
    vi.spyOn(client, "listJiraIssueTransitions")
      .mockResolvedValueOnce([{ id: "11", name: "Start", toStatusName: "In Progress" }])
      .mockResolvedValueOnce([
        { id: "21", name: "Review", toStatusName: "Ready for Review" },
        { id: "22", name: "Back", toStatusName: "To Do" },
      ])
      .mockResolvedValueOnce([{ id: "31", name: "Ready", toStatusName: "Ready for Testing" }]);
    const transition = vi.spyOn(client, "transitionJiraIssue").mockResolvedValue(undefined);

    const result = await pushPlannerStatusToJira(credentials, "BR-1", "Ready for Testing");

    expect(transition.mock.calls.map((call) => call[2])).toEqual(["11", "21", "31"]);
    expect(result).toEqual({ changed: true, fromStatus: "To Do", toStatus: "Ready for Testing" });
  });

  it("takes the furthest allowed step and uses a direct transition as soon as it appears", async () => {
    vi.spyOn(client, "getJiraIssueStatusName").mockResolvedValue("To Do");
    vi.spyOn(client, "listJiraIssueTransitions")
      .mockResolvedValueOnce([
        { id: "a", name: "Start", toStatusName: "In Progress" },
        { id: "b", name: "Review", toStatusName: "Ready for Review" },
      ])
      .mockResolvedValueOnce([{ id: "c", name: "Ready", toStatusName: "Ready for Testing" }]);
    const transition = vi.spyOn(client, "transitionJiraIssue").mockResolvedValue(undefined);

    const result = await pushPlannerStatusToJira(credentials, "BR-1", "Ready for Testing");

    expect(transition.mock.calls.map((call) => call[2])).toEqual(["b", "c"]);
    expect(result.toStatus).toBe("Ready for Testing");
    expect(result.warning).toBeUndefined();
  });

  it("warns with the status it reached when the forward path stops midway", async () => {
    vi.spyOn(client, "getJiraIssueStatusName").mockResolvedValue("To Do");
    vi.spyOn(client, "listJiraIssueTransitions")
      .mockResolvedValueOnce([{ id: "11", name: "Start", toStatusName: "In Progress" }])
      .mockResolvedValueOnce([{ id: "41", name: "Block", toStatusName: "Blocked" }]);
    vi.spyOn(client, "transitionJiraIssue").mockResolvedValue(undefined);

    const result = await pushPlannerStatusToJira(credentials, "BR-1", "Ready for Testing");

    expect(result.changed).toBe(true);
    expect(result.toStatus).toBe("In Progress");
    expect(result.warning).toContain('Moved BR-1 from "To Do" to "In Progress" but could not continue');
  });

  it("never steps backwards toward the target", async () => {
    vi.spyOn(client, "getJiraIssueStatusName").mockResolvedValue("Ready for Testing");
    vi.spyOn(client, "listJiraIssueTransitions").mockResolvedValue([
      { id: "r", name: "Review", toStatusName: "Ready for Review" },
    ]);
    const transition = vi.spyOn(client, "transitionJiraIssue").mockResolvedValue(undefined);

    const result = await pushPlannerStatusToJira(credentials, "BR-1", "In Progress");

    expect(transition).not.toHaveBeenCalled();
    expect(result.warning).toContain("Could not move BR-1");
  });
});

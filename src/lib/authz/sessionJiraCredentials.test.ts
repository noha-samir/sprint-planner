import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const resolveJiraSiteUrlMock = vi.fn();
const getJiraApiTokenMock = vi.fn();

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/integrations/jira/configStore", () => ({
  resolveJiraSiteUrl: (...args: unknown[]) => resolveJiraSiteUrlMock(...args),
}));
vi.mock("@/lib/authz/jiraAccountsStore", () => ({
  getJiraApiToken: (...args: unknown[]) => getJiraApiTokenMock(...args),
}));

import { getSessionJiraCredentials, requireJiraApiCredentials } from "./sessionJiraCredentials";

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { email: "Me@Example.com" } });
  resolveJiraSiteUrlMock.mockReset().mockResolvedValue("example.atlassian.net/");
  getJiraApiTokenMock.mockReset().mockResolvedValue("token");
});

describe("requireJiraApiCredentials", () => {
  it("uses the given session email without loading the session again, and looks up the site once", async () => {
    await expect(requireJiraApiCredentials("ventures", "me@example.com")).resolves.toEqual({
      siteUrl: "https://example.atlassian.net",
      email: "me@example.com",
      apiToken: "token",
    });
    expect(authMock).not.toHaveBeenCalled();
    expect(resolveJiraSiteUrlMock).toHaveBeenCalledTimes(1);
    expect(resolveJiraSiteUrlMock).toHaveBeenCalledWith("ventures");
  });

  it("falls back to the session email when none is given", async () => {
    await expect(requireJiraApiCredentials("ventures")).resolves.toMatchObject({ email: "me@example.com" });
    expect(authMock).toHaveBeenCalledTimes(1);
  });

  it("throws 503 when no Jira site is configured", async () => {
    resolveJiraSiteUrlMock.mockResolvedValue("");
    await expect(requireJiraApiCredentials("ventures", "me@example.com")).rejects.toMatchObject({ status: 503 });
  });

  it("throws 401 when the user has no Jira token or the session is revoked", async () => {
    getJiraApiTokenMock.mockResolvedValue(null);
    await expect(requireJiraApiCredentials("ventures", "me@example.com")).rejects.toMatchObject({ status: 401 });

    getJiraApiTokenMock.mockResolvedValue("token");
    authMock.mockResolvedValue({ error: "SessionRevoked", user: { email: "me@example.com" } });
    await expect(requireJiraApiCredentials("ventures")).rejects.toMatchObject({ status: 401 });
    expect(getJiraApiTokenMock).toHaveBeenCalledTimes(1);
  });
});

describe("getSessionJiraCredentials", () => {
  it("returns null instead of throwing when credentials are missing", async () => {
    resolveJiraSiteUrlMock.mockResolvedValue("");
    await expect(getSessionJiraCredentials("ventures")).resolves.toBeNull();
  });
});

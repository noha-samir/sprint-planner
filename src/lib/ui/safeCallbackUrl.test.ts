import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./safeCallbackUrl";

describe("safeCallbackUrl", () => {
  it("allows relative paths", () => {
    expect(safeCallbackUrl("/")).toBe("/");
    expect(safeCallbackUrl("/timeline")).toBe("/timeline");
    expect(safeCallbackUrl("/config?x=1")).toBe("/config?x=1");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeCallbackUrl("https://evil.com")).toBe("/");
    expect(safeCallbackUrl("//evil.com")).toBe("/");
    expect(safeCallbackUrl("https://evil.com/path", "/home")).toBe("/home");
  });
});

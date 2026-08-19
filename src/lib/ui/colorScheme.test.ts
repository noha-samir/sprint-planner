import { describe, expect, it } from "vitest";
import { parseColorScheme } from "./colorScheme";

describe("parseColorScheme", () => {
  it("accepts light and dark only", () => {
    expect(parseColorScheme("light")).toBe("light");
    expect(parseColorScheme("dark")).toBe("dark");
    expect(parseColorScheme("ocean")).toBeNull();
    expect(parseColorScheme("")).toBeNull();
    expect(parseColorScheme(null)).toBeNull();
  });
});

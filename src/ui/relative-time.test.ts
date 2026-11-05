import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

describe("relativeTime", () => {
  const now = Date.UTC(2026, 10, 4, 12, 0);
  const minutes = (m: number) => now - m * 60_000;

  it.each([
    [0.5, "now"],
    [14, "14m"],
    [95, "1h"],
    [26 * 60, "1d"],
  ])("%d minutes ago reads %s", (m, expected) => {
    expect(relativeTime(minutes(m), now)).toBe(expected);
  });

  it("shows nothing for a Bot that has no activity yet", () => {
    expect(relativeTime(0, now)).toBe("");
  });

  it("treats a time in the future as now", () => {
    expect(relativeTime(now + 5_000, now)).toBe("now");
  });
});

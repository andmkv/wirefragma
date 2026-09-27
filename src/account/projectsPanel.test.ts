import { describe, expect, it } from "vitest";
import { relativeAge } from "./ProjectsPanel";

describe("relativeAge", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  it("formats MySQL UTC timestamps compactly", () => {
    expect(relativeAge("2026-09-27 11:59:40", now)).toBe("now");
    expect(relativeAge("2026-09-27 11:55:00", now)).toBe("5m");
    expect(relativeAge("2026-09-27 09:00:00", now)).toBe("3h");
    expect(relativeAge("2026-09-25 12:00:00", now)).toBe("2d");
    expect(relativeAge("2026-06-27 12:00:00", now)).toBe("3mo");
  });
  it("returns an empty string for garbage", () => {
    expect(relativeAge("not a date", now)).toBe("");
  });
});

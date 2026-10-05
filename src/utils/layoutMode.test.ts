import { describe, expect, it } from "vitest";
import {
  DESKTOP_MIN_WIDTH,
  TABLET_MIN_WIDTH,
  layoutModeForWidth,
  usesOverlayDrawers
} from "./layoutMode";

describe("layoutModeForWidth", () => {
  it("uses the documented breakpoints", () => {
    expect(DESKTOP_MIN_WIDTH).toBe(1100);
    expect(TABLET_MIN_WIDTH).toBe(768);
    expect(layoutModeForWidth(1920)).toBe("desktop");
    expect(layoutModeForWidth(1280)).toBe("desktop");
    expect(layoutModeForWidth(1100)).toBe("desktop");
    expect(layoutModeForWidth(1099)).toBe("tablet");
    expect(layoutModeForWidth(820)).toBe("tablet");
    expect(layoutModeForWidth(768)).toBe("tablet");
    expect(layoutModeForWidth(767)).toBe("phone");
    expect(layoutModeForWidth(390)).toBe("phone");
    expect(layoutModeForWidth(320)).toBe("phone");
  });

  it("falls back to desktop for a nonsense width", () => {
    expect(layoutModeForWidth(Number.NaN)).toBe("desktop");
    expect(layoutModeForWidth(Number.POSITIVE_INFINITY)).toBe("desktop");
  });

  it("only the desktop layout shows the side columns", () => {
    expect(usesOverlayDrawers("desktop")).toBe(false);
    expect(usesOverlayDrawers("tablet")).toBe(true);
    expect(usesOverlayDrawers("phone")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { CROP_PADDING, faceTooSmall, selectEnrollmentFace, squarePadRect } from "../faceCrop";

const box = (x: number, y: number, w: number, h: number): [number, number, number, number] => [
  x,
  y,
  w,
  h,
];

describe("squarePadRect", () => {
  it("squares a tall box and adds context on every side", () => {
    const rect = squarePadRect(box(0.4, 0.3, 0.1, 0.2), 1000, 1000);
    expect(rect.w).toBe(rect.h);
    // Side = longest edge * (1 + 2 * padding), rounded.
    expect(rect.w).toBe(Math.round(200 * (1 + 2 * CROP_PADDING)));
  });

  it("keeps the face centred when there is room", () => {
    const rect = squarePadRect(box(0.45, 0.45, 0.1, 0.1), 1000, 1000);
    const centreX = rect.x + rect.w / 2;
    const centreY = rect.y + rect.h / 2;
    expect(Math.abs(centreX - 500)).toBeLessThanOrEqual(1);
    expect(Math.abs(centreY - 500)).toBeLessThanOrEqual(1);
  });

  it("clamps to the frame instead of reading past the edge", () => {
    const rect = squarePadRect(box(0.9, 0.9, 0.2, 0.2), 640, 480);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(640);
    expect(rect.y + rect.h).toBeLessThanOrEqual(480);
  });

  it("never exceeds the frame for a full-frame detection", () => {
    const rect = squarePadRect(box(0, 0, 1, 1), 800, 600);
    expect(rect.w).toBeLessThanOrEqual(600);
    expect(rect.h).toBeLessThanOrEqual(600);
  });

  it("falls back to the whole frame for a degenerate box", () => {
    expect(squarePadRect(box(0.5, 0.5, 0, 0), 320, 240)).toEqual({ x: 0, y: 0, w: 320, h: 240 });
  });
});

describe("faceTooSmall", () => {
  it("rejects a distant face", () => {
    expect(faceTooSmall(box(0.4, 0.4, 0.05, 0.05))).toBe(true);
  });

  it("accepts a face that fills a usable share of the frame", () => {
    expect(faceTooSmall(box(0.3, 0.3, 0.3, 0.3))).toBe(false);
  });
});

describe("selectEnrollmentFace", () => {
  it("accepts a single clear face", () => {
    const pick = selectEnrollmentFace([{ bbox: box(0.3, 0.3, 0.3, 0.3) }], 1000);
    expect(pick.ok).toBe(true);
  });

  it("rejects an empty photo", () => {
    const pick = selectEnrollmentFace([], 1000);
    expect(pick).toEqual({ ok: false, reason: "no-face" });
  });

  it("rejects a group photo instead of enrolling the biggest stranger", () => {
    const pick = selectEnrollmentFace(
      [{ bbox: box(0.1, 0.1, 0.3, 0.3) }, { bbox: box(0.6, 0.2, 0.25, 0.25) }],
      1000,
    );
    expect(pick).toEqual({ ok: false, reason: "multiple-faces" });
  });

  it("still accepts a photo with a tiny bystander in the background", () => {
    const pick = selectEnrollmentFace(
      [{ bbox: box(0.2, 0.2, 0.4, 0.4) }, { bbox: box(0.8, 0.8, 0.05, 0.05) }],
      1000,
    );
    expect(pick.ok).toBe(true);
  });

  it("rejects a face that is too small to embed", () => {
    const pick = selectEnrollmentFace([{ bbox: box(0.4, 0.4, 0.05, 0.05) }], 1000);
    expect(pick).toEqual({ ok: false, reason: "face-too-small" });
  });
});

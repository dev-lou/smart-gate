import { describe, expect, it } from "vitest";
import { SINGLE_ZONE, assignFacesToSlots, slotOfFace, standingZoneFor } from "../slotZones";

const box = (
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number, number, number] => [x, y, w, h];

const zone = SINGLE_ZONE[0];

/** A face centred in the oval, sized as a fraction of it. */
function faceIn(scale = 0.5) {
  const w = zone.rx * scale;
  const h = zone.ry * scale;
  return { bbox: box(zone.cx - w / 2, zone.cy - h / 2, w, h) };
}

describe("SINGLE_ZONE", () => {
  it("is one centred standing spot", () => {
    expect(SINGLE_ZONE).toHaveLength(1);
    expect(zone.id).toBe(0);
    expect(zone.cx).toBeCloseTo(0.5);
    expect(zone.cy).toBeCloseTo(0.49);
  });

  it("stays inside the frame", () => {
    expect(zone.cx - zone.rx).toBeGreaterThan(0);
    expect(zone.cx + zone.rx).toBeLessThan(1);
    expect(zone.cy - zone.ry).toBeGreaterThan(0);
    expect(zone.cy + zone.ry).toBeLessThan(1);
  });

  it("draws a tall oval, not a circle", () => {
    // ry is a fraction of the frame HEIGHT and rx of the WIDTH. On a 16:9 kiosk
    // the height is ~56% of the width, so ry has to clear 1.8x rx before the
    // drawn ellipse is actually taller than it is wide.
    expect(zone.ry).toBeGreaterThan(zone.rx * 1.8);
  });

  it("fits the middle slice a portrait screen shows", () => {
    // A 16:9 frame in an 824x1079 window is covered by scaling to the height,
    // which crops the sides and leaves only the middle ~43% of the width
    // visible. A wider oval would be cut off at both edges.
    expect(zone.rx * 2).toBeLessThan(0.43);
  });
});

describe("standingZoneFor", () => {
  it("keeps the default oval on a 16:9 screen", () => {
    const fitted = standingZoneFor({
      frameWidth: 1280,
      frameHeight: 720,
      boxWidth: 1280,
      viewportWidth: 1280,
    });
    expect(fitted.rx).toBeCloseTo(SINGLE_ZONE[0].rx);
    expect(fitted.ry).toBe(SINGLE_ZONE[0].ry);
  });

  it("narrows the oval so it fits a portrait phone's middle slice", () => {
    // 390x844 window: covering a 16:9 frame means scaling to the height, which
    // leaves only the middle ~333 of 1280 columns on screen.
    const boxWidth = (844 / 720) * 1280;
    const fitted = standingZoneFor({
      frameWidth: 1280,
      frameHeight: 720,
      boxWidth,
      viewportWidth: 390,
    });
    expect(fitted.rx).toBeLessThan(0.11);
    expect(fitted.ry).toBeGreaterThan(fitted.rx * 1.78);
    const cssWidth = fitted.rx * 2 * 1280 * (boxWidth / 1280);
    expect(cssWidth).toBeLessThan(390);
  });

  it("never widens past the default", () => {
    const fitted = standingZoneFor({
      frameWidth: 1280,
      frameHeight: 720,
      boxWidth: 2560,
      viewportWidth: 2560,
    });
    expect(fitted.rx).toBeCloseTo(SINGLE_ZONE[0].rx);
  });
});

describe("slotOfFace", () => {
  it("reads a face centred in the oval", () => {
    expect(slotOfFace(faceIn().bbox, SINGLE_ZONE)).toBe(0);
    expect(slotOfFace([0.4, 0.3, 0.2, 0.24])).toBe(0);
  });

  it("ignores a face outside the oval, where a second lane used to be", () => {
    expect(slotOfFace(box(0.75, 0.42, 0.12, 0.16), SINGLE_ZONE)).toBeNull();
    expect(slotOfFace(box(0.2, 0.42, 0.12, 0.16), SINGLE_ZONE)).toBeNull();
  });

  it("ignores a passer-by at the edge of the frame", () => {
    expect(slotOfFace(box(0.02, 0.3, 0.08, 0.1), SINGLE_ZONE)).toBeNull();
  });

  it("ignores a degenerate box", () => {
    expect(slotOfFace(box(0.3, 0.5, 0, 0), SINGLE_ZONE)).toBeNull();
  });
});

describe("assignFacesToSlots", () => {
  it("keeps the face standing in the oval", () => {
    const inside = faceIn();
    expect(assignFacesToSlots([inside], SINGLE_ZONE)).toEqual([{ face: inside, slot: 0 }]);
  });

  it("drops everyone outside the oval", () => {
    const inside = faceIn();
    const crowdBehind = { bbox: box(0.44, 0.12, 0.07, 0.09) };
    const passerBy = { bbox: box(0.88, 0.3, 0.08, 0.1) };
    expect(assignFacesToSlots([crowdBehind, inside, passerBy], SINGLE_ZONE)).toEqual([
      { face: inside, slot: 0 },
    ]);
  });

  it("keeps the larger face when two people crowd the oval", () => {
    const small = { bbox: box(zone.cx - 0.02, zone.cy - 0.03, 0.05, 0.07) };
    const large = { bbox: box(zone.cx - 0.06, zone.cy - 0.08, 0.12, 0.16) };
    expect(assignFacesToSlots([small, large], SINGLE_ZONE)).toEqual([{ face: large, slot: 0 }]);
  });

  it("returns nothing when nobody is in the oval", () => {
    expect(assignFacesToSlots([{ bbox: box(0.5, 0.92, 0.05, 0.06) }], SINGLE_ZONE)).toEqual([]);
  });
});

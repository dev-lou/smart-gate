import { describe, expect, it } from "vitest";
import { SINGLE_ZONE, SLOT_ZONES, assignFacesToSlots, slotOfFace } from "../slotZones";

const box = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x, y, w, h];

/** A face centred in a zone, sized so it fills a third of the oval. */
function faceIn(zoneId: number, scale = 0.5): { bbox: [number, number, number, number] } {
  const zone = SLOT_ZONES.find((z) => z.id === zoneId)!;
  const w = zone.rx * scale;
  const h = zone.ry * scale;
  return { bbox: box(zone.cx - w / 2, zone.cy - h / 2, w, h) };
}

describe("slotOfFace", () => {
  it("puts a face centred in the left oval in slot 0", () => {
    expect(slotOfFace(faceIn(0).bbox)).toBe(0);
  });

  it("puts a face centred in the right oval in slot 1", () => {
    expect(slotOfFace(faceIn(1).bbox)).toBe(1);
  });

  it("ignores someone standing between the two ovals", () => {
    expect(slotOfFace(box(0.47, 0.45, 0.06, 0.08))).toBeNull();
  });

  it("ignores a passer-by at the edge of the frame", () => {
    expect(slotOfFace(box(0.02, 0.3, 0.08, 0.1))).toBeNull();
  });

  it("ignores a degenerate box", () => {
    expect(slotOfFace(box(0.3, 0.5, 0, 0))).toBeNull();
  });
});

describe("SLOT_ZONES", () => {
  it("mirrors the two ovals either side of the centre line", () => {
    const [left, right] = SLOT_ZONES;
    expect(left.cx).toBeCloseTo(1 - right.cx);
    expect(left.cy).toBe(right.cy);
    expect(left.rx).toBe(right.rx);
    expect(left.ry).toBe(right.ry);
  });

  it("keeps both ovals clear of the centre line", () => {
    for (const zone of SLOT_ZONES) {
      expect(zone.cx - zone.rx).toBeGreaterThan(0);
      expect(zone.cx + zone.rx).toBeLessThan(1);
    }
    expect(SLOT_ZONES[0].cx + SLOT_ZONES[0].rx).toBeLessThan(0.5);
    expect(SLOT_ZONES[1].cx - SLOT_ZONES[1].rx).toBeGreaterThan(0.5);
  });

  it("draws a tall oval, not a circle", () => {
    // ry is a fraction of the frame HEIGHT and rx of the WIDTH. On a 16:9
    // kiosk the height is ~56% of the width, so ry has to clear 1.8x rx before
    // the drawn ellipse is actually taller than it is wide.
    for (const zone of SLOT_ZONES) {
      expect(zone.ry).toBeGreaterThan(zone.rx * 1.8);
    }
  });
});

describe("SINGLE_ZONE", () => {
  it("is one centred standing spot", () => {
    expect(SINGLE_ZONE).toHaveLength(1);
    expect(SINGLE_ZONE[0].id).toBe(0);
    expect(SINGLE_ZONE[0].cx).toBeCloseTo(0.5);
    expect(SINGLE_ZONE[0].ry).toBeGreaterThan(SINGLE_ZONE[0].rx);
  });

  it("reads a face standing in the middle of the screen", () => {
    expect(slotOfFace([0.4, 0.3, 0.2, 0.24], SINGLE_ZONE)).toBe(0);
  });

  it("still ignores a passer-by at the edge", () => {
    expect(slotOfFace([0.02, 0.3, 0.08, 0.1], SINGLE_ZONE)).toBeNull();
  });

  it("assigns the single standing spot", () => {
    const face = { bbox: box(0.4, 0.3, 0.2, 0.24) as [number, number, number, number] };
    expect(assignFacesToSlots([face], SINGLE_ZONE)).toEqual([{ face, slot: 0 }]);
  });
});

describe("assignFacesToSlots", () => {
  it("assigns one face to each oval when two students stand side by side", () => {
    const left = faceIn(0);
    const right = faceIn(1);
    expect(assignFacesToSlots([left, right])).toEqual([
      { face: left, slot: 0 },
      { face: right, slot: 1 },
    ]);
  });

  it("drops faces that are not standing in an oval", () => {
    const left = faceIn(0);
    const crowd = { bbox: box(0.45, 0.2, 0.07, 0.09) };
    expect(assignFacesToSlots([left, crowd])).toEqual([{ face: left, slot: 0 }]);
  });

  it("keeps the larger face when two people crowd the same oval", () => {
    const zone = SLOT_ZONES[0];
    const small = { bbox: box(zone.cx - 0.03, zone.cy - 0.04, 0.06, 0.08) };
    const large = { bbox: box(zone.cx - 0.05, zone.cy - 0.07, 0.1, 0.14) };
    expect(assignFacesToSlots([small, large])).toEqual([{ face: large, slot: 0 }]);
  });

  it("returns nothing when nobody is in the ovals", () => {
    expect(assignFacesToSlots([{ bbox: box(0.5, 0.9, 0.05, 0.06) }])).toEqual([]);
  });
});

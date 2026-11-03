/**
 * Standing positions
 * ==================
 * The kiosk reads at most TWO people at once on a desktop display, and ONE on a
 * phone or tablet where two half-width ovals would leave neither target usable.
 *
 * This is the fix for the crowd problem. Previously the loop took the LARGEST
 * face in frame, so anyone behind the student — a queue, a passer-by, someone
 * leaning in — could win the frame and be named instead. With fixed zones the
 * answer belongs to the person standing where the UI told them to stand, and
 * everybody else is ignored.
 *
 * The oval is tall rather than wide, matching a standing person's head and
 * shoulders, and it stops short of 0.5 so nobody is ever attributed across the
 * black divider. Radii are fractions of DIFFERENT sides: ry is a fraction of the
 * frame height, which is only ~56% of the width on a 16:9 kiosk, so ry has to be
 * roughly 1.8x rx before the drawn shape actually looks taller than it is wide.
 *
 * Two, not three: every face costs one ArcFace embedding plus a match, and the
 * inference worker runs them one at a time. Two fits comfortably inside the
 * 500 ms recognition tick; three starts to queue and makes students wait.
 *
 * Pure maths — no DOM — so the assignment rules are unit-tested.
 */

export interface SlotZone {
  id: number;
  /** Centre and radii as fractions of the frame (0-1). */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Desktop / landscape: two standing spots either side of the divider. */
export const SLOT_ZONES: readonly SlotZone[] = [
  { id: 0, cx: 0.32, cy: 0.49, rx: 0.17, ry: 0.38 },
  { id: 1, cx: 0.68, cy: 0.49, rx: 0.17, ry: 0.38 },
];

/**
 * Phone / tablet: one spot in the middle. Two ovals on a 390 px screen would be
 * 190 px targets each; one centred oval is the same UI with the second lane
 * switched off, not a squeezed version of the desktop layout.
 */
export const SINGLE_ZONE: readonly SlotZone[] = [
  { id: 0, cx: 0.5, cy: 0.49, rx: 0.26, ry: 0.38 },
];

/**
 * Exactly on the ellipse counts; a face centred between the two ovals does not.
 * (Slack here let someone standing in the gap be read as the left student.)
 */
const EDGE_TOLERANCE = 1.0;

/** Which standing position a face is centred in, or null when it is not. */
export function slotOfFace(
  bbox: readonly [number, number, number, number],
  zones: readonly SlotZone[] = SLOT_ZONES,
): number | null {
  if (bbox[2] <= 0 || bbox[3] <= 0) return null;
  const cx = bbox[0] + bbox[2] / 2;
  const cy = bbox[1] + bbox[3] / 2;

  let best: { id: number; distance: number } | null = null;
  for (const zone of zones) {
    const dx = (cx - zone.cx) / zone.rx;
    const dy = (cy - zone.cy) / zone.ry;
    const distance = dx * dx + dy * dy;
    if (distance <= EDGE_TOLERANCE && (!best || distance < best.distance)) {
      best = { id: zone.id, distance };
    }
  }
  return best ? best.id : null;
}

/**
 * One face per oval, largest wins if two people crowd the same one.
 * Faces outside every oval are not returned at all.
 */
export function assignFacesToSlots<T extends { bbox: [number, number, number, number] }>(
  faces: readonly T[],
  zones: readonly SlotZone[] = SLOT_ZONES,
): Array<{ face: T; slot: number }> {
  const perSlot = new Map<number, T>();

  for (const face of faces) {
    const slot = slotOfFace(face.bbox, zones);
    if (slot === null) continue;
    const current = perSlot.get(slot);
    if (!current || face.bbox[2] * face.bbox[3] > current.bbox[2] * current.bbox[3]) {
      perSlot.set(slot, face);
    }
  }

  return [...perSlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, face]) => ({ face, slot }));
}

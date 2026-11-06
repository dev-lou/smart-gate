/**
 * The standing position
 * =====================
 * The kiosk reads ONE person at a time, standing in ONE oval. That gate is the
 * whole safety story: a face is only read when its centre is inside the oval, so
 * a queue behind the student, a passer-by at the edge of frame or someone
 * leaning in can never win the frame and be named instead.
 *
 * The old two-lane desktop layout asked two students to stand still in two
 * different places at once. In a real lobby the second lane stayed empty, so it
 * is gone rather than left half-working.
 *
 * The oval is tall rather than wide, matching a standing person's head and
 * shoulders. Radii are fractions of DIFFERENT sides — rx of the frame WIDTH, ry
 * of the HEIGHT — and height is only ~56% of width on a 16:9 kiosk, so ry has to
 * clear roughly 1.8x rx before the drawn shape is actually taller than it is
 * wide.
 *
 * Pure maths — no DOM — so the standing rule is unit-tested.
 */

export interface SlotZone {
  id: number;
  /** Centre and radii as fractions of the frame (0-1). */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * The one standing spot, the same shape on every screen.
 *
 * These are fractions of the CAMERA FRAME, not of the window, and that frame is
 * landscape on every device. A portrait phone shows only the middle slice of it
 * (object-fit: cover crops the sides), so the oval has to be narrow enough to
 * fit that slice — a "phone" variant that widened rx to 0.26 drew an oval wider
 * than an 824 px screen and clipped it on both sides.
 */
export const SINGLE_ZONE: readonly SlotZone[] = [{ id: 0, cx: 0.5, cy: 0.49, rx: 0.17, ry: 0.38 }];

/** How much of the visible width the oval should take. */
const OVAL_WIDTH_SHARE = 0.78;

/** Narrower than this and the oval is too small to aim at. */
const MIN_RX = 0.1;

/**
 * The oval sized for the screen it is actually shown on.
 *
 * A 16:9 camera frame in a portrait window is covered by scaling to the height,
 * which crops the sides: a 390x844 phone shows only the middle ~26% of the frame
 * width, where the fixed rx of 0.17 would draw an oval wider than the screen and
 * slice it off at both edges. So rx shrinks until the drawn oval fits the
 * visible slice, and only ever narrows — the desktop shape is the widest it gets.
 * ry stays put, so the oval only becomes more clearly oval on a phone.
 */
export function standingZoneFor(args: {
  frameWidth: number;
  frameHeight: number;
  boxWidth: number;
  viewportWidth: number;
}): SlotZone {
  const frame = args.frameWidth > 0 ? args.frameWidth : 1;
  const scale = args.boxWidth > 0 ? args.boxWidth / frame : 1;
  const visibleFrameWidth = scale > 0 ? args.viewportWidth / scale : frame;
  const rx = Math.min(
    SINGLE_ZONE[0].rx,
    Math.max(MIN_RX, (OVAL_WIDTH_SHARE * visibleFrameWidth) / (2 * frame)),
  );
  return { id: 0, cx: 0.5, cy: 0.49, rx, ry: SINGLE_ZONE[0].ry };
}

/**
 * Exactly on the ellipse counts; a face centred outside it does not. (Slack here
 * would let someone standing just outside the oval be read as the student.)
 */
const EDGE_TOLERANCE = 1.0;

/** Which standing position a face is centred in, or null when it is not. */
export function slotOfFace(
  bbox: readonly [number, number, number, number],
  zones: readonly SlotZone[] = SINGLE_ZONE,
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
 * The face standing in the oval, or nothing.
 *
 * Everyone outside every oval is dropped, and when two people crowd the same
 * oval the larger face wins — that is the person actually standing at the kiosk,
 * not the one waving behind them.
 */
export function assignFacesToSlots<T extends { bbox: [number, number, number, number] }>(
  faces: readonly T[],
  zones: readonly SlotZone[] = SINGLE_ZONE,
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

  return [...perSlot.entries()].sort((a, b) => a[0] - b[0]).map(([slot, face]) => ({ face, slot }));
}

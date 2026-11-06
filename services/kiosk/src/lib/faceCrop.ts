/**
 * Face crop geometry
 * ==================
 * Pure maths for turning a detector box into the square, margin-padded crop an
 * ArcFace model expects.
 *
 * Why this exists: the old code fed the raw detector box straight into the
 * resize. That box is tight — it clips the forehead and chin, and it is not
 * square, so the 112x112 squash distorts the face differently depending on the
 * angle someone stands at. Enrollment photos and live frames took the same
 * shortcut, so a face could match itself while looking nothing like the same
 * person across angles. One shared helper keeps both paths identical.
 *
 * The enrollment picker is here for a second reason: "largest face in the
 * photo" attached a classmate's embedding to a student whenever the uploaded
 * picture was a group shot.
 */

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Context kept around the detected box, per side, as a fraction of its size. */
export const CROP_PADDING = 0.175;

/** Below this share of the frame width a face is too small to score. */
export const MIN_FACE_WIDTH_RATIO = 0.12;

/** Enrollment floor matches the scoring floor, so an enrolled photo can never
 *  be one the recogniser would refuse to embed. */
export const ENROLLMENT_MIN_FACE_RATIO = 0.12;

/** A second face this large relative to the biggest one means the photo is
 *  ambiguous (group shot, photo of a photo) and must not be enrolled. */
export const ENROLLMENT_DOMINANT_RATIO = 0.25;

/**
 * Square, padded crop around a normalized bbox, clamped to the frame.
 * Falls back to the whole frame for degenerate boxes rather than producing a
 * zero-width crop.
 */
export function squarePadRect(
  bbox: readonly [number, number, number, number],
  frameWidth: number,
  frameHeight: number,
): CropRect {
  const fw = Math.max(1, Math.floor(frameWidth));
  const fh = Math.max(1, Math.floor(frameHeight));

  const bx = bbox[0] * fw;
  const by = bbox[1] * fh;
  const bw = bbox[2] * fw;
  const bh = bbox[3] * fh;

  if (!Number.isFinite(bw) || !Number.isFinite(bh) || bw <= 0 || bh <= 0) {
    return { x: 0, y: 0, w: fw, h: fh };
  }

  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const side = Math.min(Math.max(bw, bh) * (1 + 2 * CROP_PADDING), Math.min(fw, fh));

  const x = Math.round(Math.min(Math.max(cx - side / 2, 0), fw - side));
  const y = Math.round(Math.min(Math.max(cy - side / 2, 0), fh - side));

  return { x, y, w: Math.max(1, Math.round(side)), h: Math.max(1, Math.round(side)) };
}

/** True when the detected face is too small in frame to be worth scoring. */
export function faceTooSmall(bbox: readonly [number, number, number, number]): boolean {
  return bbox[2] < MIN_FACE_WIDTH_RATIO;
}

export type EnrollmentPick<T> =
  { ok: true; face: T } | { ok: false; reason: "no-face" | "multiple-faces" | "face-too-small" };

/**
 * Choose the one face an enrollment photo is allowed to contribute.
 *
 * Rejects the photo when a second comparable face is present: taking the
 * largest one there is how a student ends up carrying a classmate's embedding
 * and the kiosk greets the wrong person by name.
 */
export function selectEnrollmentFace<T extends { bbox: [number, number, number, number] }>(
  faces: readonly T[],
  imageWidth: number,
): EnrollmentPick<T> {
  if (faces.length === 0) return { ok: false, reason: "no-face" };

  const area = (f: T) => f.bbox[2] * f.bbox[3];
  const sorted = [...faces].sort((a, b) => area(b) - area(a));
  const largest = sorted[0];
  const largestArea = area(largest);

  if (largest.bbox[2] < ENROLLMENT_MIN_FACE_RATIO) return { ok: false, reason: "face-too-small" };
  if (Number.isFinite(imageWidth) && imageWidth > 0 && largest.bbox[2] * imageWidth < 24) {
    return { ok: false, reason: "face-too-small" };
  }

  const rival = sorted.slice(1).find((f) => area(f) >= largestArea * ENROLLMENT_DOMINANT_RATIO);
  if (rival) return { ok: false, reason: "multiple-faces" };

  return { ok: true, face: largest };
}

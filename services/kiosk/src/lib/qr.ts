/**
 * School-ID QR payloads
 * =====================
 * The QR is derived from the student ID printed on the school ID: `SG1:<id>`.
 * The prefix exists so an arbitrary QR code (a menu, a poster, someone else's
 * unrelated code) can never be mistaken for a student ID.
 *
 * Pure functions only — the camera decode lives in `qrScan.ts` so this module
 * stays testable without a DOM.
 */

export const QR_PREFIX = "SG1:";

/** A scanned code counts as "presented" for this long after it was read. */
export const QR_FRESH_MS = 5000;

/** Longer than any real school ID, short enough to reject junk payloads. */
export const MAX_QR_LENGTH = 128;

export interface QrSignal {
  studentId: string;
  /** When the code was last decoded from the camera. */
  seenAt: number;
}

/** What the code in front of the camera resolved to. */
export type QrOutcome =
  | { code: "DISABLED" }
  | { code: "NO_CODE" }
  | { code: "STALE" }
  | { code: "ENROLLED"; studentId: string }
  | { code: "UNKNOWN"; studentId: string };

export function normalizeStudentId(id: string | null | undefined): string {
  // Guest profiles carry no student ID; callers pass every enrolled profile.
  if (typeof id !== "string") return "";
  return id.trim().toUpperCase();
}

/** Build the payload printed on a student's ID. */
export function encodeStudentQr(studentId: string): string {
  return `${QR_PREFIX}${studentId.trim()}`;
}

/** Extract a student ID from a decoded payload, or null if it is not ours. */
export function parseQrPayload(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text || text.length > MAX_QR_LENGTH) return null;
  if (!text.toUpperCase().startsWith(QR_PREFIX)) return null;
  const id = text.slice(QR_PREFIX.length).trim();
  if (!id || id.length > MAX_QR_LENGTH - QR_PREFIX.length) return null;
  return id;
}

/** True while a code read at `seenAt` still counts as presented. */
export function isQrFresh(seenAt: number, now: number, windowMs: number = QR_FRESH_MS): boolean {
  if (!Number.isFinite(seenAt) || seenAt <= 0) return false;
  const age = now - seenAt;
  return age >= 0 && age <= windowMs;
}

/**
 * Resolve the school-ID code in front of the camera.
 *
 * The QR is a FALLBACK, not a second factor: a recognised face opens the gate
 * on its own, and the code exists so a student whose face cannot be read is
 * not stuck at the barrier. An unrecognised code is reported separately so the
 * kiosk can say "this ID is not enrolled" instead of silently ignoring it.
 */
export function evaluateScannedQr(args: {
  allowQr: boolean;
  qr: QrSignal | null;
  now: number;
  enrolledStudentIds: readonly string[];
}): QrOutcome {
  if (!args.allowQr) return { code: "DISABLED" };
  if (!args.qr) return { code: "NO_CODE" };
  if (!isQrFresh(args.qr.seenAt, args.now)) return { code: "STALE" };

  const scanned = normalizeStudentId(args.qr.studentId);
  const match = args.enrolledStudentIds.find((id) => normalizeStudentId(id) === scanned);
  if (!match) return { code: "UNKNOWN", studentId: args.qr.studentId };
  return { code: "ENROLLED", studentId: match };
}

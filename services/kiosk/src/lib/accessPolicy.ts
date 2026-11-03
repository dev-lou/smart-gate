/**
 * Guest E-Pass validity (016 policy: lockdown > guest expiry > face).
 * ==================================================================
 * Pure and framework-free on purpose: the kiosk's grant/deny decision for a
 * guest is only as trustworthy as this comparison, so it must be testable
 * without a camera, a face match, or a running browser.
 *
 * The pass is stored as an ISO-8601 instant (the guard writes
 * `new Date(...).toISOString()`, Supabase returns TIMESTAMPTZ as
 * `...+00:00`). Both parse identically through Date.parse, so the comparison
 * is instant-vs-instant and independent of the device timezone.
 */

export interface GuestPassState {
  /** True once the current instant is past valid_until. */
  expired: boolean;
  /** Human label for the expiry instant; only set when expired. */
  expiryLabel: string;
}

const EXPIRY_LABEL_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/**
 * Decide whether a guest pass has lapsed.
 *
 * Missing, empty or unparseable values are treated as "no expiry configured"
 * and do NOT deny — identical to the behaviour the kiosk shipped with, and
 * deliberate: a data problem must not strand a person at the gate.
 */
export function evaluateGuestPass(
  validUntil: string | null | undefined,
  now: number = Date.now(),
): GuestPassState {
  if (!validUntil) return { expired: false, expiryLabel: "" };
  const t = Date.parse(validUntil);
  if (Number.isNaN(t)) return { expired: false, expiryLabel: "" };
  // Strictly past the instant — a pass is still usable during its final
  // second, and an equal timestamp is not yet expired.
  if (now <= t) return { expired: false, expiryLabel: "" };
  return {
    expired: true,
    expiryLabel: new Date(t).toLocaleString("en-US", EXPIRY_LABEL_FORMAT),
  };
}

/**
 * Scan Policy — when the kiosk may decide, and how the gate is reported.
 * ======================================================================
 * Pure functions only: no DOM, no React, no timers. `app/page.tsx` owns the
 * state and calls these; the unit tests exercise them directly.
 *
 * They exist because of a real failure. After a grant the kiosk held the verdict
 * for a few seconds and then re-recognised whoever was still standing in front
 * of it, writing a fresh `access_logs` row every ~5 seconds — one student
 * produced 140 rows in a single sitting, and the attendance view became
 * unreadable. Leaving the frame is now what re-arms the scanner.
 */

/** The gate area must be empty this long before another decision is allowed. */
export const REARM_ABSENCE_MS = 1500;

/** How long the verdict card stays on screen after a decision. */
export const VERDICT_HOLD_MS = 8000;

/** How long the small "last result" strip lingers once the card clears. */
export const LAST_RESULT_HOLD_MS = 30_000;

/** How long the "you are already recorded" notice keeps showing for a
 *  visitor whose generation was already logged. */
export const NOTICE_WINDOW_MS = 60_000;

/** The frame being empty this long takes the decision notice down early —
 *  its student has clearly walked on. A returning student gets it re-shown
 *  from the per-person decision map, anchored to the original decision. */
export const NOTICE_ABSENCE_CLEAR_MS = 10_000;

/** A person must read below threshold this long before the kiosk treats them
 *  as unrecognised — the first frames of a walk-up are mid-motion and measure
 *  far under the person's real similarity (0.26 before settling at 0.63). */
export const UNKNOWN_DWELL_MS = 2_500;

/** Per-person repeat suppression: a decision for the same person inside this
 *  window is still shown on screen, but writes no second access row. */
export const PERSON_COOLDOWN_MS = 60_000;

/** How long a just-decided person is not re-decided at all, even standing
 *  perfectly still — far shorter than the log-suppression window, and only
 *  ever applied to the person who was just decided. Everyone else (a new
 *  arrival stepping in front of the camera) is decided immediately. */
export const PERSON_REDECIDE_MS = 4_000;

/**
 * How the gate is reported to the student.
 * - `OPEN`     the controller confirmed the barrier released
 * - `AWAITING` a controller is linked but has not confirmed
 * - `SENT`     a command was issued with nothing linked (demo mode)
 */
export type GateOutcome = "OPEN" | "AWAITING" | "SENT";

export interface PresenceState {
  /** Timestamp the frame last became empty; 0 while a face is in view. */
  faceFreeSince: number;
  /** False from the moment a decision is logged until absence re-arms it. */
  rearmed: boolean;
}

/**
 * Advance the re-arm state machine by one frame.
 *
 * `faceFreeSince` resets to 0 the instant a face is present, and `rearmed` only
 * returns to true after the frame has stayed empty for `absenceMs`. A person who
 * never leaves the frame therefore never re-arms, so standing still at the gate
 * produces one decision instead of one every few seconds.
 */
export function nextPresence(args: {
  facePresent: boolean;
  state: PresenceState;
  now: number;
  absenceMs?: number;
}): PresenceState {
  const absenceMs = args.absenceMs ?? REARM_ABSENCE_MS;

  if (args.facePresent) {
    // Still in frame — the clock stays at 0, the re-arm flag is untouched.
    return { faceFreeSince: 0, rearmed: args.state.rearmed };
  }

  const faceFreeSince = args.state.faceFreeSince === 0 ? args.now : args.state.faceFreeSince;
  const rearmed = args.state.rearmed || args.now - faceFreeSince >= absenceMs;
  return { faceFreeSince, rearmed };
}

/** True when this decision repeats one for the same person inside the cooldown. */
export function isRepeatDecision(args: { lastDecisionAt: number; now: number }): boolean {
  if (args.lastDecisionAt <= 0) return false;
  return args.now - args.lastDecisionAt < PERSON_COOLDOWN_MS;
}

/**
 * Identity-aware decision gate: may the kiosk run a full decision (uniform
 * check / verdict / log row / gate command) for the face currently in frame?
 *
 * Recognition ALWAYS runs — what is gated per-person is the decision. The
 * caller looks up the prior decision FOR THE IDENTITY IN FRAME (a brand-new
 * student has none, and is therefore always decided immediately, even while
 * the previous student's "already recorded" notice is still on screen):
 *
 *   • No prior decision for this identity       → decide.
 *   • Prior decision, frame never cleared since → same stay, one decision.
 *   • Frame cleared since, inside the short re-decide hold → not yet.
 *   • Frame cleared since, hold elapsed         → decide (a genuine return
 *     visit; the per-person cooldown still suppresses a duplicate log row).
 *
 * `frameEmptySinceLastDecision` must be true only when the gate area was
 * empty for a real absence (≥ REARM_ABSENCE_MS) after the prior decision —
 * a single dropped detection frame does not end a stay.
 */
export function shouldDecide(args: {
  /** When the identity in frame was last decided (0 = never). */
  lastDecisionAt: number;
  /** True when a real absence separated the frame from the prior decision. */
  frameEmptySinceLastDecision: boolean;
  now: number;
}): boolean {
  if (args.lastDecisionAt <= 0) return true;
  if (!args.frameEmptySinceLastDecision) return false;
  return args.now - args.lastDecisionAt >= PERSON_REDECIDE_MS;
}

/** A below-threshold read only counts as "unrecognised" once the low reading
 *  has persisted for the dwell window — a settling frame must never be scored. */
export function isSettledUnknown(args: {
  matched: boolean;
  firstSeenAt: number;
  now: number;
}): boolean {
  if (args.matched) return false;
  if (args.firstSeenAt <= 0) return false;
  return args.now - args.firstSeenAt >= UNKNOWN_DWELL_MS;
}

/**
 * The honest gate outcome. A command sent to no controller is not an open
 * barrier — reporting silence there made an unwired gate look like a broken one.
 */
export function resolveGateOutcome(args: {
  gateConnected: boolean;
  confirmed?: boolean;
}): GateOutcome {
  if (!args.gateConnected) return "SENT";
  return args.confirmed ? "OPEN" : "AWAITING";
}

/** The value written to `access_logs.gate_state` for a given outcome. */
export function gateStateForLog(args: { gateConnected: boolean; confirmed?: boolean }): string {
  if (!args.gateConnected) return "simulated";
  return args.confirmed ? "open" : "unconfirmed";
}

/**
 * Advance the visit generation.
 *
 * A "visit" is one person's stay at the gate. The generation advances only when
 * the frame has been empty for the full absence window AND the scanner has
 * re-armed — so a one-second dart out of frame and back is the SAME visit (gen
 * 1 -> 1), while a real departure is a new one (gen 1 -> 2). Access rows are
 * written once per generation, which is what stops a quick step-aside from
 * recording a second entry while still letting the next student through.
 */
export function visitGeneration(args: { rearmed: boolean; current: number }): {
  gen: number;
  isNew: boolean;
} {
  return { gen: args.rearmed ? args.current + 1 : args.current, isNew: args.rearmed };
}

/**
 * Clamp the gate-open window from Settings. Floors at 3s so the banner can
 * never flash past unreadably, caps at 60s so a typo can't wedge the terminal.
 */
export function clampGateWindow(seconds: number): number {
  if (!Number.isFinite(seconds)) return 5;
  return Math.min(60, Math.max(3, Math.round(seconds)));
}

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

/**
 * Minimum time a result card (name + course) is guaranteed to stay on screen.
 *
 * A QR entry opens the gate with NOBODY in the oval — that is the whole point
 * of it — so the "frame has been empty, the visitor walked on" reset fired on
 * the very next tick and wiped the card a frame after it appeared. The student
 * could not tell whether their code had been accepted. Nothing is allowed to
 * take the card down before this window elapses.
 */
export const RESULT_CARD_MIN_HOLD_MS = 5000;

/** True while a just-shown result card is still inside its guaranteed hold. */
export function resultCardHolding(cardHoldUntil: number, now: number): boolean {
  return now < cardHoldUntil;
}

/**
 * How long before the same person standing still is greeted a second time.
 * Long on purpose: a student who has walked up and been read is ONE arrival,
 * and repeating the welcome while they stand there would talk over itself.
 */
export const WELCOME_REPEAT_MS = 30_000;

/**
 * Should the kiosk greet this arrival out loud?
 *
 * The welcome used to be bound to a GRANT, so it only played when a full
 * decision ran — a student already recorded inside the one-minute window, or
 * one read again before the decision gate re-armed, arrived in silence. Every
 * recognised arrival gets its welcome; the only guard is against repeating it
 * for the same person who has not moved.
 */
export function shouldAnnounceWelcome(
  last: { id: string; at: number } | null | undefined,
  id: string,
  now: number,
  repeatMs = WELCOME_REPEAT_MS,
): boolean {
  if (!last || last.id !== id) return true;
  return now - last.at >= repeatMs;
}

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

/**
 * A settled "unknown face" card is taken down this quickly once the frame
 * goes empty — the visitor clearly walked on, so the screen must reset to
 * reading someone new instead of accusing the next arrival. The dwell clock
 * restarts with it, so every face gets a fresh read.
 */
export const UNKNOWN_ABSENCE_CLEAR_MS = 2_000;

/** True when the gate area has been empty long enough to retire a stale
 *  unknown-face card and reset the recognition trackers for the next visitor.
 *  A blink or one dropped detection frame never reads as "walked away". */
export function shouldClearStaleScan(args: {
  faceFreeSince: number;
  now: number;
  ms?: number;
}): boolean {
  if (args.faceFreeSince <= 0) return false;
  return args.now - args.faceFreeSince >= (args.ms ?? UNKNOWN_ABSENCE_CLEAR_MS);
}

/**
 * Per-person repeat suppression: a decision for the same person inside this
 * window is still shown on screen, but writes no second access row.
 *
 * One minute was longer than the visit: a student who stepped out and came back
 * was told "already recorded" and the gate never opened for them again. Eight
 * seconds still covers a shoelace-stop, while a genuine second pass is a second
 * entry and is logged as one. The anti-flood guard that actually matters is
 * shouldDecide(), which allows one decision per stay whatever this says.
 */
export const PERSON_COOLDOWN_MS = 8_000;

/** How long a just-decided person is not re-decided at all, even standing
 *  perfectly still — far shorter than the log-suppression window, and only
 *  ever applied to the person who was just decided. Everyone else (a new
 *  arrival stepping in front of the camera) is decided immediately. */
export const PERSON_REDECIDE_MS = 2_500;

/**
 * Face matching window \u2014 how the kiosk decides WHICH student is standing there.
 *
 * One hot frame is not a verdict: at walk-up speed the first frames score the
 * RIGHT student at 0.26, and a motion-blurred frame can score a stranger at
 * 0.61. So every matched recognition tick is collected for three seconds and
 * nobody is named until the window closes.
 *
 * The winner is the identity with the best AVERAGE score across the window, not
 * whoever won the last frame. The previous rule demanded that the same identity
 * win consecutive ticks, so one flicker towards a lookalike threw away every
 * sample already collected and restarted the count \u2014 the correct student's
 * name arrived late, or never appeared at all.
 */
export const FACE_MATCH_WINDOW_MS = 3000;

/**
 * A name needs more than one lucky frame behind it. At the walk-up cadence a
 * three-second window yields six to twelve reads from a student standing there,
 * so anything thinner is a glimpse — a passer-by in the corridor, a face at the
 * edge of frame — and must never be named.
 */
export const MIN_FACE_SAMPLES = 2;

/** One recognition tick inside the matching window. */
export interface FaceSample {
  /** Enrolled identity the tick read, or "" when the frame matched nobody. */
  id: string;
  /** Cosine similarity of that read. */
  score: number;
  /** When the read happened (ms since epoch). */
  at: number;
}

/** Samples gathered for one standing position. `startedAt: 0` = not started. */
export interface FaceWindow {
  startedAt: number;
  samples: FaceSample[];
}

export const EMPTY_FACE_WINDOW: FaceWindow = { startedAt: 0, samples: [] };

/** Cap the buffer: a long stay must not grow it without bound. */
const MAX_FACE_SAMPLES = 40;

/** Open a fresh window at `now`. */
export function startFaceWindow(now: number): FaceWindow {
  return { startedAt: now, samples: [] };
}

/** Add one tick's read; the first sample opens the window if it is not open. */
export function recordFaceSample(win: FaceWindow, sample: FaceSample): FaceWindow {
  const startedAt = win.startedAt === 0 ? sample.at : win.startedAt;
  const samples = [...win.samples, sample].slice(-MAX_FACE_SAMPLES);
  return { startedAt, samples };
}

/** True once the window has run its full span. */
export function faceWindowElapsed(win: FaceWindow, now: number): boolean {
  if (win.startedAt === 0) return false;
  return now - win.startedAt >= FACE_MATCH_WINDOW_MS;
}

/**
 * The identity with the best average similarity across the window, how many
 * reads backed it, and the best average among every OTHER identity.
 *
 * The runner-up is what makes a lookalike safe: naming a winner that sits within
 * a hair of the next-closest enrolled profile is how the wrong student ends up
 * on the card, so the caller compares the two before it decides anything.
 * Null while no identity was ever read. A tie goes to the identity seen in more
 * frames, where more evidence is the better bet.
 */
export function bestFaceInWindow(
  win: FaceWindow,
): { id: string; score: number; samples: number; runnerUp: number } | null {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const sample of win.samples) {
    if (!sample.id) continue;
    const entry = totals.get(sample.id) ?? { sum: 0, count: 0 };
    entry.sum += sample.score;
    entry.count += 1;
    totals.set(sample.id, entry);
  }

  const averages = [...totals].map(([id, entry]) => ({
    id,
    score: entry.sum / entry.count,
    samples: entry.count,
  }));

  let best: { id: string; score: number; samples: number } | null = null;
  for (const entry of averages) {
    if (
      !best ||
      entry.score > best.score ||
      (entry.score === best.score && entry.samples > best.samples)
    ) {
      best = entry;
    }
  }
  if (!best) return null;

  let runnerUp = -1;
  for (const entry of averages) {
    if (entry.id === best.id) continue;
    if (entry.score > runnerUp) runnerUp = entry.score;
  }

  return { ...best, runnerUp };
}

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

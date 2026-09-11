"use client";

/**
 * Kiosk Voice / Audio Module
 * ==========================
 * Offline audio feedback for the kiosk — no audio files, no internet:
 *   - Chimes synthesized with the WebAudio API
 *   - Speech via the built-in browser speechSynthesis engine
 *
 * Sounds:
 *   - Grant:  pleasant two-tone chime + "Welcome to ISUFST"
 *   - Deny:   low buzz + "Access denied. Please see the guard."
 *   - Override: short click + "Manual override."
 *   - Unknown face: soft beep, throttled (see shouldPlayBeep)
 *
 * Autoplay policy: browsers block audio until the user interacts once.
 * Call unlockAudio() from the Tap-to-Start gesture — after that all
 * sounds play freely, even after network loss.
 */

// ─── Types ──────────────────────────────────────────────────

export type VoiceCue = "grant" | "deny" | "override" | "unknown";

// ─── State ──────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
let unlocked = false;
let voiceEnabled = true;

// ─── Pure throttle logic (unit-testable) ────────────────────

/**
 * Should an "unknown face" beep play now?
 * Fires at most once per window; resets after the window passes.
 * Pure: pass the previous state in, get the new state back.
 */
export function shouldPlayBeep(
  lastPlayedAt: number,
  now: number,
  windowMs = 10_000,
): { play: boolean; lastPlayedAt: number } {
  // lastPlayedAt <= 0 means "never played" — always fire
  const neverPlayed = lastPlayedAt <= 0;
  if (neverPlayed || now - lastPlayedAt >= windowMs) {
    return { play: true, lastPlayedAt: now };
  }
  return { play: false, lastPlayedAt };
}

// ─── Unlock (call from a user gesture) ──────────────────────

/**
 * Create/resume the AudioContext and speak a silent utterance.
 * MUST be called from inside a user gesture handler (the splash tap).
 */
export function unlockAudio(): void {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) audioCtx = new Ctor();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    // Speak an empty utterance once — some Android browsers need this
    // to unlock speechSynthesis from a gesture.
    if (typeof speechSynthesis !== "undefined") {
      const u = new SpeechSynthesisUtterance("");
      u.volume = 0;
      speechSynthesis.speak(u);
    }
    unlocked = true;
  } catch {
    // Audio is best-effort — never break the kiosk over it
    unlocked = true;
  }
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

// ─── Settings ───────────────────────────────────────────────

export function setVoiceEnabled(enabled: boolean): void {
  voiceEnabled = enabled;
}

export function isVoiceEnabled(): boolean {
  return voiceEnabled;
}

// ─── Chime synthesis ────────────────────────────────────────

function tone(
  freq: number,
  startOffsetMs: number,
  durationMs: number,
  type: OscillatorType,
  volume: number,
): void {
  if (!audioCtx) return;
  const start = audioCtx.currentTime + startOffsetMs / 1000;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  // Smooth attack/decay so chimes don't click
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.05);
}

function playChime(cue: VoiceCue): void {
  if (!audioCtx || audioCtx.state === "suspended") return;

  switch (cue) {
    case "grant":
      // Pleasant rising two-tone (E5 → A5)
      tone(659, 0, 220, "sine", 0.22);
      tone(880, 140, 320, "sine", 0.22);
      break;
    case "deny":
      // Low harsh buzz
      tone(180, 0, 380, "sawtooth", 0.15);
      tone(140, 120, 380, "sawtooth", 0.12);
      break;
    case "override":
      // Short mid click
      tone(520, 0, 90, "square", 0.12);
      break;
    case "unknown":
      // Soft neutral beep
      tone(440, 0, 120, "sine", 0.1);
      break;
  }
}

// ─── Speech ─────────────────────────────────────────────────

function speak(text: string): void {
  if (typeof speechSynthesis === "undefined") return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 0.9;
    u.lang = "en-US";
    // Prefer an English voice if one is loaded
    const voices = speechSynthesis.getVoices();
    const en = voices.find((v) => v.lang.startsWith("en"));
    if (en) u.voice = en;
    speechSynthesis.cancel(); // Don't queue — latest message wins
    speechSynthesis.speak(u);
  } catch {
    // Best-effort
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * School initials spoken in the grant message (from synced settings).
 * Defaults to ISUFST until the kiosk loads its settings.
 */
let schoolInitials = "ISUFST";

export function setVoiceSchool(initials: string): void {
  if (initials && initials.trim().length > 0) {
    schoolInitials = initials.trim();
  }
}

/**
 * Play the full audio cue: chime + voice line.
 */
export function playCue(cue: VoiceCue): void {
  if (!voiceEnabled) return;
  playChime(cue);

  switch (cue) {
    case "grant":
      speak(`Welcome to ${schoolInitials}.`);
      break;
    case "deny":
      speak("Access denied. Please see the guard.");
      break;
    case "override":
      speak("Manual override.");
      break;
    case "unknown":
      // Beep only — do not talk to strangers at a gate
      break;
  }
}

/**
 * Test hook for the admin panel / debugging.
 */
export function primeSpeechVoices(): void {
  if (typeof speechSynthesis !== "undefined") {
    // Forces the voice list to populate on Chrome/Android
    speechSynthesis.getVoices();
  }
}

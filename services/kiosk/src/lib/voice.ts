"use client";

/**
 * Kiosk Voice / Audio Module
 * ==========================
 * Offline audio feedback for the kiosk — no internet:
 *   - Chimes synthesized with the WebAudio API
 *   - Human voice lines from /public/audio/*.mp3 when present
 *     (welcome.mp3, denied.mp3, override.mp3) — a real recording beats
 *     any device TTS. Missing files fall back to speechSynthesis.
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

/**
 * Pick a natural-sounding female English voice for the gate.
 * Device TTS varies by browser/OS, so this prefers known-natural female
 * voices (Google US English, Microsoft Aria/Jenny/Natasha, Samsung) and
 * falls back to any female-named English voice, then any English voice.
 * Returns null when no English voice is loaded yet.
 */
function pickFemaleVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const voices = speechSynthesis.getVoices();
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (en.length === 0) return null;
  // Known-natural female voices, in preference order
  const preferred = [
    "google us english", // Chrome/Android — warm female by default
    "microsoft aria", // Windows natural female
    "microsoft jenny", // Windows natural female
    "microsoft natasha", // Windows female
    "microsoft zira", // Windows female
    "samantha", // Apple female
  ];
  for (const name of preferred) {
    const hit = en.find((v) => v.name.toLowerCase().includes(name));
    if (hit) return hit;
  }
  // Any voice whose name reads female
  const femaleHint = en.find((v) =>
    /female|girl|woman|aria|jenny|natasha|zira|samantha|victoria|tessa|fiona|veena|kanya/i.test(
      v.name,
    ),
  );
  if (femaleHint) return femaleHint;
  // Avoid an obviously male default when there is a choice
  const nonMale = en.find((v) => !/male|david|mark|guy|daniel|george|fred/i.test(v.name));
  return nonMale ?? en[0];
}

function speak(text: string): void {
  if (typeof speechSynthesis === "undefined") return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    // Slightly slowed rate + lifted pitch reads warmer and less robotic
    u.rate = 0.97;
    u.pitch = 1.1;
    u.volume = 1.0;
    u.lang = "en-US";
    const voice = pickFemaleVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
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

// ─── Human voice recordings ─────────────────────────────────
// Drop real recordings in services/kiosk/public/audio/:
//   welcome.mp3  — "Welcome to ISUFST." (grant)
//   denied.mp3   — "Access denied. Please see the guard." (deny)
//   override.mp3 — "Manual override." (override)
// Any decent phone recorder works — record close, quiet room, female voice.
// A missing/unplayable file silently falls back to speechSynthesis.
const VOICE_FILES: Record<VoiceCue, string | null> = {
  grant: "/audio/welcome.mp3",
  deny: "/audio/denied.mp3",
  override: "/audio/override.mp3",
  unknown: null,
};

const voiceCache = new Map<string, HTMLAudioElement>();

function playRecording(cue: VoiceCue, fallback: () => void): void {
  const file = VOICE_FILES[cue];
  if (!file || typeof Audio === "undefined") {
    fallback();
    return;
  }
  try {
    let audio = voiceCache.get(file);
    if (!audio) {
      audio = new Audio(file);
      audio.preload = "auto";
      voiceCache.set(file, audio);
    } else {
      audio.currentTime = 0;
    }
    const current = audio;
    // If the file is missing or undecodable, fall back to device speech.
    const onError = () => {
      current.removeEventListener("error", onError);
      voiceCache.delete(file);
      fallback();
    };
    current.addEventListener("error", onError, { once: true });
    const playPromise = current.play();
    if (playPromise) playPromise.catch(onError);
  } catch {
    fallback();
  }
}

/**
 * Play the full audio cue: chime + human voice line (device speech fallback).
 */
export function playCue(cue: VoiceCue): void {
  if (!voiceEnabled) return;
  playChime(cue);

  switch (cue) {
    case "grant":
      playRecording(cue, () => speak(`Welcome to ${schoolInitials}.`));
      break;
    case "deny":
      playRecording(cue, () => speak("Access denied. Please see the guard."));
      break;
    case "override":
      playRecording(cue, () => speak("Manual override."));
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

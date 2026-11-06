"use client";

import { evaluateGuestPass } from "@/lib/accessPolicy";
import { evaluateScannedQr, normalizeStudentId, type QrSignal } from "@/lib/qr";
import { decodeStudentQr } from "@/lib/qrScan";
import { faceTooSmall, selectEnrollmentFace } from "@/lib/faceCrop";
import {
  SINGLE_ZONE,
  type SlotZone,
  assignFacesToSlots,
  slotOfFace,
  standingZoneFor,
} from "@/lib/slotZones";

import { useEffect, useRef, useState } from "react";
import {
  AMBIGUOUS_GAP,
  initFaceDetector,
  initFaceRecognizer,
  detectFaces,
  detectFacesFromCanvas,
  getFaceEmbedding,
  getFaceEmbeddingFromCanvas,
  matchFace,
  MIN_MATCH_THRESHOLD,
  cleanupFaceResources,
  type FaceResult,
  type EnrolledFace,
  type MatchResult,
} from "@/lib/face";
import {
  checkUniform,
  initUniformDetector,
  torsoRegion,
  type UniformCheckResult,
} from "@/lib/uniform";
import {
  connectToGate,
  tryAutoConnect,
  disconnectGate,
  openGate,
  closeGate,
  confirmGateOpen,
  onGateEvent,
  isGateSupported,
  type GateEvent,
  type GateTransport,
} from "@/lib/gate";
import {
  MIN_FACE_SAMPLES,
  LAST_RESULT_HOLD_MS,
  NOTICE_WINDOW_MS,
  NOTICE_ABSENCE_CLEAR_MS,
  UNKNOWN_ABSENCE_CLEAR_MS,
  VERDICT_HOLD_MS,
  RESULT_CARD_MIN_HOLD_MS,
  resultCardHolding,
  clampGateWindow,
  FACE_MATCH_WINDOW_MS,
  shouldClearStaleScan,
  EMPTY_FACE_WINDOW,
  gateStateForLog,
  startFaceWindow,
  recordFaceSample,
  faceWindowElapsed,
  bestFaceInWindow,
  isRepeatDecision,
  isSettledUnknown,
  nextPresence,
  resolveGateOutcome,
  shouldDecide,
  shouldAnnounceWelcome,
  type FaceWindow,
} from "@/lib/scanPolicy";
import {
  getEnrolledFaces,
  getAllStudents,
  addLog,
  getActiveStudents,
  getStudent,
  storeStudents,
  getAllSettings,
  getDatabaseStats,
  getSetting,
  storeSetting,
  getUnsyncedLogs,
  type StoredStudent,
  type StoredLog,
} from "@/lib/db";
import { fullSync, initSupabase } from "@/lib/supabase";
import {
  startHeartbeat,
  stopHeartbeat,
  sendHeartbeat,
  isHeartbeatTableMissing,
  type HeartbeatInput,
} from "@/lib/heartbeat";
import {
  ShieldCheck,
  Wifi,
  WifiOff,
  Plug,
  RefreshCw,
  AlertCircle,
  XCircle,
  Link,
  CheckCircle2,
  Settings,
  Volume2,
  Play,
  Scan,
  Sparkles,
  Database,
  Clock,
  Lock,
  Ticket,
  UserCheck,
  ArrowRight,
  Cpu,
} from "lucide-react";
import {
  unlockAudio,
  primeSpeechVoices,
  playCue,
  setVoiceEnabled,
  setVoiceSchool,
  shouldPlayBeep,
} from "@/lib/voice";

// ─── Types ──────────────────────────────────────────────────

type KioskState =
  "init" | "loading_models" | "ready" | "scanning" | "granted" | "denied" | "error" | "offline";

/**
 * Live pipeline phase, published to the on-screen scan indicator so anyone
 * standing at the terminal can see what the AI is doing right now:
 *   searching → looking for a face
 *   face      → a face is in frame, checking identity
 *   verify    → identity matched, reading the uniform (amber torso box)
 *   done      → a verdict was reached (grant/deny card takes over)
 */
type ScanStep = "searching" | "face" | "verify" | "done";

/** Visual state of one step in the on-screen scan pipeline. */
type StepVisual = "idle" | "working" | "ok" | "fail";

/**
 * How often recognition (ArcFace embedding + match + YOLO uniform check) may
 * run for the person in front of the camera. Face *detection* keeps running
 * at close to camera framerate so the reticle tracks smoothly; only the
 * expensive identity/uniform step is throttled.
 */
const RECOGNIZE_INTERVAL_MS = 500;

/** How long to wait for the camera before booting into hardware test mode. */
const CAMERA_START_TIMEOUT_MS = 12000;

/** What a standing position shows once its student is confirmed. */
type SlotCard = {
  id: string;
  name: string;
  department: string;
  confidence: number;
  /** Uniform line shown under the name (null when the check was skipped). */
  uniform?: string | null;
} | null;

/** What one standing position is reporting right now. */
type SlotPhase = "empty" | "verifying" | "confirmed" | "unknown" | "granted" | "denied";

/** How long a detected face keeps its reticle before it is considered gone. */
const FACE_RETICLE_HOLD_MS = 1200;

// ─── Overlay drawing helpers ────────────────────────────────
// Plain canvas primitives so the HUD costs nothing extra: the loop already
// paints this canvas every frame, we just give it something useful to say.

/**
 * Rect the browser actually PAINTS a `object-fit: cover` video into, in viewport
 * coordinates.
 *
 * Why this matters: the HUD is drawn on a canvas using normalized bbox ratios
 * measured against the raw camera frame. If that canvas simply stretches over
 * the element box while the video `cover`s it, the two show different regions —
 * a 4:3 camera in a tall box crops ~35% of the width — so every reticle lands
 * off the face and circles render as ellipses. Matching the painted box keeps
 * HUD and image in exact 1:1 correspondence.
 */
function coverContentBox(video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const scale = Math.max(rect.width / vw, rect.height / vh);
  const width = vw * scale;
  const height = vh * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

/**
 * The gate banner speaks only about a *decision* outcome (opened / awaiting a
 * controller / sent with none linked). Live controller broadcasts (IDLE,
 * OPENING, CLOSING) arrive on the same state and would otherwise render as
 * "no controller linked" while the gate is perfectly linked.
 */
function isDecisionGateBanner(state: string | null): boolean {
  return state === "OPEN" || state === "AWAITING" || state === "SENT";
}

/** Keep the overlay canvas pinned to the video's painted content box. */
function syncOverlayToVideo(overlayCanvas: HTMLCanvasElement, video: HTMLVideoElement) {
  const box = coverContentBox(video);
  if (!box.width || !box.height) return null;
  const style = overlayCanvas.style;
  style.left = `${box.left}px`;
  style.top = `${box.top}px`;
  style.width = `${box.width}px`;
  style.height = `${box.height}px`;
  return box;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Corner brackets — the classic "this is what I am tracking" reticle. */
function drawBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: string,
  alpha: number,
  lineWidth: number,
  len: number,
) {
  const l = Math.min(len, w * 0.45, h * 0.45);
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  const corners: Array<[number, number, number, number]> = [
    [x, y + l, x, y],
    [x, y, x + l, y],
    [x + w - l, y, x + w, y],
    [x + w, y, x + w, y + l],
    [x + w, y + h - l, x + w, y + h],
    [x + w, y + h, x + w - l, y + h],
    [x + l, y + h, x, y + h],
    [x, y + h, x, y + h - l],
  ];
  for (const [x1, y1, x2, y2] of corners) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

/**
 * Small pill label (rounded background + bold text) anchored to a point.
 *
 * Privacy note: these labels carry detector telemetry ("FACE 98%",
 * "CICI BLAZER 92%") — never a student's name or identity. Identity only
 * ever appears in the grant/deny card after a decision.
 */
function drawChip(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  text: string,
  rgb: string,
  align: "left" | "center" = "left",
  fontSize: number,
) {
  ctx.font = `800 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  const padX = fontSize * 0.6;
  const padY = fontSize * 0.44;
  const textWidth = ctx.measureText(text).width;
  const w = textWidth + padX * 2;
  const h = fontSize + padY * 2;
  const x = align === "center" ? anchorX - w / 2 : anchorX;
  const y = anchorY - h;

  ctx.save();
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = `rgba(${rgb}, 0.92)`;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + h / 2 + fontSize * 0.04);
  ctx.restore();
  return { width: w, height: h };
}

/** One step of the on-screen scan pipeline. */
function ScanStepPill({ label, state }: { label: string; state: StepVisual }) {
  // The state is carried by the icon and the text colour against a barely-there
  // wash, not by a filled coloured box — the camera image is the interface, the
  // chrome is only there so the words stay legible on top of it.
  const styles: Record<StepVisual, string> = {
    idle: "text-surface-500",
    working: "text-blue-700",
    ok: "text-emerald-700",
    fail: "text-rose-600",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-md shadow-sm text-[10px] sm:text-xs font-black uppercase tracking-wider ${styles[state]}`}
    >
      {state === "working" ? (
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      ) : state === "ok" ? (
        <CheckCircle2 className="w-3.5 h-3.5" />
      ) : state === "fail" ? (
        <XCircle className="w-3.5 h-3.5" />
      ) : (
        <span className="w-3 h-3 rounded-full border-2 border-current opacity-40" />
      )}
      {label}
    </span>
  );
}

/**
 * Persistent plain-language policy readout for the live rail.
 * Waiting while no identity is confirmed yet, verifying while the face
 * dwell runs, then the hold notice once a decision owns the screen.
 * Display only — it never feeds back into the recognition pipeline.
 */
function PolicyReadout({
  scanStep,
  holdNotice,
}: {
  scanStep: ScanStep;
  holdNotice: {
    kind: "granted" | "denied";
    name: string;
    at: number;
    personId?: string;
    detail?: string;
  } | null;
}) {
  let text: string;
  let tone: string;
  let pulse = false;
  // A decision owns the screen: never show a "still working" phase under a
  // verdict notice — the phase state goes stale the moment the card clears
  // (scanStep is reset separately) and the two messages contradict each
  // other ("Access denied" next to a pulsing "Reading uniform").
  if (holdNotice) {
    if (holdNotice.kind === "denied") {
      text = holdNotice.detail ?? "Access denied — see the guard";
      tone = "text-rose-600";
    } else {
      text = "Already recorded — no need to re-scan";
      tone = "text-emerald-700";
    }
  } else if (scanStep === "face") {
    text = "Verifying — hold still";
    tone = "text-blue-700";
    pulse = true;
  } else if (scanStep === "verify") {
    text = "Reading uniform — hold still";
    tone = "text-amber-700";
    pulse = true;
  } else if (scanStep === "done") {
    text = "Policy: face + pass check";
    tone = "text-surface-500";
  } else {
    text = "Policy: waiting for face…";
    tone = "text-surface-500";
  }
  return (
    <p
      className={`max-w-full rounded-lg bg-white/90 backdrop-blur-md px-2.5 py-1 text-[11px] font-bold leading-snug shadow-sm flex items-center gap-1.5 ${tone} ${pulse ? "animate-pulse" : ""}`}
    >
      <Scan className="w-3.5 h-3.5 shrink-0" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

// ─── Main Component ─────────────────────────────────────────

export default function KioskPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const [kioskState, setKioskState] = useState<KioskState>("init");
  const [statusMessage, setStatusMessage] = useState("Starting up...");
  const [enrolledCount, setEnrolledCount] = useState(0);
  // Sync downloads a profile for every active student, but a profile only gets a
  // biometric template if a face can be detected in its enrollment photo. Those
  // that can't are invisible to the matcher — the student stands at the gate,
  // nothing matches, and nobody can tell whether the terminal or the enrollment
  // is at fault. Track it so it is impossible to miss before a demo.
  const [enrollmentHealth, setEnrollmentHealth] = useState({
    total: 0,
    withFace: 0,
    missing: [] as string[],
  });
  const [lastMatch, setLastMatch] = useState<MatchResult | null>(null);
  const [scanStep, setScanStep] = useState<ScanStep>("searching");
  const [fps, setFps] = useState(0);
  const [gateConnected, setGateConnected] = useState(false);
  const [gateTransport, setGateTransport] = useState<GateTransport | null>(null);
  // "OPEN" (controller confirmed) | "AWAITING" (linked but unconfirmed) |
  // "SENT" (command issued, no controller linked — demo mode)
  const [gateState, setGateState] = useState<string | null>(null);
  /** Seconds left in the gate open window, shown on the verdict card. */
  const [gateSecondsLeft, setGateSecondsLeft] = useState<number | null>(null);
  /** Wall-clock moment the floating gate banner must disappear (0 = none). */
  const gateBannerUntilRef = useRef(0);
  /** Survives the verdict card so the screen still shows what just happened. */
  const [lastDecision, setLastDecision] = useState<{
    name: string;
    personId: string | null;
    granted: boolean;
    at: number;
  } | null>(null);
  /**
   * The confirmed identity — the ONLY name the HUD is allowed to show.
   * Recognition ticks update a raw per-tick winner that flickers between
   * lookalikes on motion-blurred frames; publishing that raw winner is how a
   * stranger briefly wore someone else's name. `confirmed` is set only once
   * an identity holds the confirmation window (3s + runner-up margin) and is cleared the moment a different face — or
   * no face — is in frame.
   */
  const [confirmed, setConfirmed] = useState<{
    id: string;
    name: string;
    confidence: number;
  } | null>(null);
  /** Loop-safe mirror of `confirmed` for drawOverlays + processFace. */
  const confirmedRef = useRef<{ id: string; name: string; confidence: number } | null>(null);
  /** Elapsed time in the three-second match window, for the "hold still" HUD. */
  const [confirmProgress, setConfirmProgress] = useState(0);
  const [lockdownActive, setLockdownActive] = useState(false);
  const [lockdownReason, setLockdownReason] = useState("");
  /** Mirror of the synced `uniform_detection_enabled` setting, for the panel. */
  const [uniformEnforced, setUniformEnforced] = useState(true);
  /**
   * What to tell someone whose decision is already in the books.
   *
   * Set on a grant or a denial and cleared once they step out of frame. Without
   * it the rail kept saying "Face detected — hold still" with the IDENTITY chip
   * spinning at a person the kiosk was deliberately NOT re-checking — it read as
   * a frozen terminal, when the scanner was simply waiting for the gate area to
   * clear before it would log anyone again.
   */
  const [holdNotice, setHoldNotice] = useState<{
    kind: "granted" | "denied";
    name: string;
    at: number;
    personId?: string;
    detail?: string;
  } | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>("");
  const [dbStats, setDbStats] = useState({ studentCount: 0, logCount: 0, unsyncedCount: 0 });
  const [online, setOnline] = useState(true);
  // Tap-to-Start splash gates camera + audio unlock (browser autoplay policy)
  const [started, setStarted] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  /** Offline queue modal: every access row waiting in IndexedDB for upload. */
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [queueLogs, setQueueLogs] = useState<StoredLog[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueSyncing, setQueueSyncing] = useState(false);
  /** Camera never came up (no webcam / permission denied). The terminal keeps
   *  running so the gate, servo and button can still be tested. */
  const [cameraDown, setCameraDown] = useState(false);
  /** Result of the last servo / ESP32 self-test, shown in the operator panel. */
  const [hwTest, setHwTest] = useState<{
    running: boolean;
    ok: boolean | null;
    result: string | null;
  }>({ running: false, ok: null, result: null });
  const [voiceOn, setVoiceOn] = useState(true);
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }),
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // 🔴 FIX BUG #1: Use refs for state the main loop needs to read
  // React state closures would be stale inside requestAnimationFrame callbacks
  const kioskStateRef = useRef<KioskState>("init");
  const gateConnectedRef = useRef(false);
  const gateStateRef = useRef<string | null>(null);
  const onlineRef = useRef(true);

  // Keep refs in sync with React state
  useEffect(() => {
    kioskStateRef.current = kioskState;
  }, [kioskState]);
  useEffect(() => {
    gateConnectedRef.current = gateConnected;
  }, [gateConnected]);
  useEffect(() => {
    gateStateRef.current = gateState;
  }, [gateState]);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  // Tracking refs for performance
  const enrolledRef = useRef<EnrolledFace[]>([]);
  /**
   * Every ACTIVE profile, with or without a face template — the roster the
   * school-ID code is judged against.
   *
   * `enrolledRef` is the face matcher's list, and getEnrolledFaces() drops any
   * profile with zero embeddings. Validating a QR against that list rejected
   * students who simply had no template on this tablet, which made the code
   * useless for exactly the people most likely to use it.
   */
  const qrRosterRef = useRef<EnrolledFace[]>([]);
  /** School-ID QR layer: setting mirrored for render, last code read for decisions. */
  const [allowQr, setAllowQr] = useState(true);
  const [qrSeen, setQrSeen] = useState<QrSignal | null>(null);
  /** One code per oval: left student and right student each present their own. */
  const qrSlotsRef = useRef<[QrSignal | null, QrSignal | null]>([null, null]);
  const lastQrDecodeRef = useRef(0);
  /** Per-oval freshness stamp of the code already acted on. */
  const qrHandledAtRef = useRef<[number, number]>([0, 0]);
  const lastQrAttemptRef = useRef(0);
  /** When each oval's face last matched — a stale match must not block its QR. */
  const slotMatchedAtRef = useRef<[number, number]>([0, 0]);
  /** When any face last matched (shared HUD / fallback guard). */
  const lastMatchAtRef = useRef(0);
  const settingsRef = useRef<{
    matchThreshold: number;
    /** Gate open window from Settings — how long the barrier stays released. */
    gateOpenDuration: number;
    /** 015 lockdown: when true deny all with LOCKDOWN_ACTIVE. */
    lockdownMode: boolean;
    lockdownReason: string;
    /** School-ID QR: accepted as the fallback when the face is not recognised. */
    allowQr: boolean;
    /** 019 uniform: when true a student without their course uniform is denied. */
    uniformEnabled: boolean;
  }>({
    matchThreshold: 0.58,
    gateOpenDuration: 5,
    lockdownMode: false,
    lockdownReason: "",
    allowQr: true,
    uniformEnabled: true,
  });
  const settingsLoadedRef = useRef(false);

  // Branding driven by synced system_settings (school name + initials badge)
  const [schoolBrand, setSchoolBrand] = useState({
    name: "Iloilo State University of Fisheries Science and Technology",
    initials: "ISUFST",
  });
  const fpsRef = useRef(0);
  const lastFpsTime = useRef(Date.now());
  const lastMatchRef = useRef<MatchResult | null>(null);
  // Detection snapshot for the overlay: the loop draws every animation frame
  // (so the guide animates) while inference only runs every 3rd frame.
  const lastFacesRef = useRef<FaceResult[]>([]);
  const lastFaceAtRef = useRef(0);
  /**
   * Torso band currently being read by the uniform model (normalized video
   * coords + expiry). Set just before `await checkUniform` and cleared right
   * after, so the overlay can draw the "what I am reading" box while YOLO
   * runs. Refs only — the rAF loop reads it without re-rendering.
   */
  const uniformScanRef = useRef<{
    bbox: [number, number, number, number];
    until: number;
  } | null>(null);
  const lastRecognizedAtRef = useRef(0);
  const processingRef = useRef(false); // Prevents concurrent face processing
  const photoProcessingRef = useRef(false); // 🔴 FIX BUG #2: Mutex for processStudentPhotos
  const gateCleanupRef = useRef<(() => void) | null>(null); // Fix #3: Gate listener cleanup
  const lastSyncRef = useRef<string | null>(null); // For heartbeat reporting
  const lastUnknownBeepRef = useRef(0); // Throttle for unknown-face beep
  /** Bumped on every decision; verdict-card timers verify they still own the
   *  screen before resetting shared UI state (identity-aware decisions can
   *  overlap the previous card's hold window). */
  const decisionSeqRef = useRef(0);

  // ─── Re-arm / duplicate guards ──────────────────────────
  // `faceFreeSinceRef` is when the gate area last became empty (0 while someone
  // is in frame) — it tracks "real absence" (≥ REARM_ABSENCE_MS) so a blink or
  // one dropped detection frame never reads as "the student left". Decisions
  // are gated per-IDENTITY in processFace (shouldDecide), not by a global
  // lock, so a new arrival is decided immediately even while the previous
  // student's "already recorded" notice is still on screen.
  const faceFreeSinceRef = useRef(0);
  /** True while a real absence has separated the frame from the last decision. */
  const frameClearedRef = useRef(false);
  /**
   * Last decision per person_id — enforces the per-person window. Carries the
   * kind as well as the time: a GRANTED person returning inside the window is
   * told "already recorded" without a re-scan, while a DENIED person must be
   * re-checked (they may have fixed their uniform), with repeat denials still
   * kept out of the log by the denial-side guard.
   */
  const lastDecisionByPersonRef = useRef<Map<string, { at: number; granted: boolean }>>(new Map());
  /** When the current face first measured below the match threshold (0 = none). */
  const unknownSinceRef = useRef(0);
  const lastDecisionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Frozen verdict snapshot — the identity shown on the grant/deny card.
   * Recognition keeps running (and overwriting `lastMatch`) while the card is
   * up, so the card must read from this snapshot or the name vanishes the
   * moment the person ducks out of frame. Cleared when the card hold elapses.
   */
  const [verdict, setVerdict] = useState<{
    person: EnrolledFace;
    confidence: number;
    isGuest: boolean;
    uniformDetail?: string | null;
  } | null>(null);
  /**
   * Three-second matching window per standing position.
   *
   * Every matched recognition tick is collected here and the identity with the
   * best AVERAGE score wins. A flicker towards a lookalike no longer restarts
   * the count and costs the correct student their name. Policy lives in
   * scanPolicy (unit-tested); this ref only carries the samples.
   */
  const faceWindowRef = useRef<[FaceWindow, FaceWindow]>([
    { ...EMPTY_FACE_WINDOW },
    { ...EMPTY_FACE_WINDOW },
  ]);
  /** Name + course shown in each oval; null until that slot's identity confirms. */
  const slotCardsRef = useRef<[SlotCard, SlotCard]>([null, null]);
  /**
   * Timestamp the on-screen result card is guaranteed to survive until.
   *
   * A QR entry is granted with an EMPTY oval, so the stale-scan reset (which
   * exists to clear a card when its student walks away) fired immediately and
   * wiped the name + course before anyone could read it. Until this moment the
   * reset leaves the card alone.
   */
  const cardHoldUntilRef = useRef(0);
  const [slotPhases, setSlotPhases] = useState<[SlotPhase, SlotPhase]>(["empty", "empty"]);
  const [slotDetails, setSlotDetails] = useState<[string, string]>(["", ""]);
  /**
   * ONE oval, on every screen — the kiosk reads one person at a time.
   *
   * The two-lane desktop layout asked two students to stand still in two
   * different places at once. In a real lobby that never happened: the second
   * lane sat empty while the first had to carry everybody, so it is gone rather
   * than left half-working.
   *
   * The oval is still a hard gate, and that is what keeps the wrong person from
   * being named: only a face centred INSIDE it is read, so a queue behind the
   * student, a passer-by at the edge of frame or someone leaning in is ignored.
   *
   * The `portrait` flag only nudges the HUD chips. The standing oval is the
   * same shape everywhere, because it is measured in camera-frame fractions and
   * that frame is landscape on every device — a portrait window shows the middle
   * slice of it, not a portrait frame.
   */
  const [portrait, setPortrait] = useState(false);
  const zones = SINGLE_ZONE;
  const zonesRef = useRef<readonly SlotZone[]>(zones);
  zonesRef.current = zones;

  useEffect(() => {
    const query = window.matchMedia("(max-aspect-ratio: 1/1)");
    const sync = () => setPortrait(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  /** Settled unrecognised visitor — drives the amber "Unknown face" card. */
  const [unknownNotice, setUnknownNotice] = useState<{ score: number; at: number } | null>(null);
  /** Render-loop mirror of `holdNotice` — safe to read inside the rAF loop. */
  const holdNoticeRef = useRef<{
    kind: "granted" | "denied";
    name: string;
    at: number;
    personId?: string;
    detail?: string;
  } | null>(null);

  // Tick the gate-open countdown down once a second, and retire the banner the
  // moment the configured window elapses — the barrier closing is a real event
  // the screen must reflect, not something the UI simply forgets.
  useEffect(() => {
    if (gateSecondsLeft === null || gateSecondsLeft <= 0) return;
    const timer = setTimeout(() => {
      setGateSecondsLeft((seconds) => (seconds === null ? null : seconds - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [gateSecondsLeft]);

  useEffect(() => {
    if (gateSecondsLeft !== null && gateSecondsLeft <= 0) {
      setGateState(null);
      gateBannerUntilRef.current = 0;
    }
  }, [gateSecondsLeft]);

  // Keep the loop-side mirror in lockstep with the notice state.
  useEffect(() => {
    holdNoticeRef.current = holdNotice;
  }, [holdNotice]);

  // Drop the "last result" strip's timer on unmount.
  useEffect(() => {
    return () => {
      if (lastDecisionTimerRef.current) clearTimeout(lastDecisionTimerRef.current);
    };
  }, []);

  /**
   * Show the latest verdict in the small persistent strip.
   * Called for every logged decision so the screen still carries a trace once
   * the big card clears and the student has walked away.
   */
  function rememberDecision(name: string, personId: string | null, granted: boolean) {
    setLastDecision({ name, personId, granted, at: Date.now() });
    if (lastDecisionTimerRef.current) clearTimeout(lastDecisionTimerRef.current);
    lastDecisionTimerRef.current = setTimeout(() => setLastDecision(null), LAST_RESULT_HOLD_MS);
  }

  /** Publish one oval's state without disturbing the other student's. */
  function setSlotPhaseAt(slot: number, phase: SlotPhase, detail = "") {
    setSlotPhases((prev) => {
      const next: [SlotPhase, SlotPhase] = [prev[0], prev[1]];
      next[slot] = phase;
      return next;
    });
    setSlotDetails((prev) => {
      const next: [string, string] = [prev[0], prev[1]];
      next[slot] = detail;
      return next;
    });
  }

  /**
   * Set once the stale-scan reset has run for this absence. The reset writes
   * React state, and `shouldClearStaleScan` stays true for as long as the gate
   * is empty — re-running it every frame re-rendered the whole kiosk at frame
   * rate whenever nobody was standing there.
   */
  const staleClearedRef = useRef(false);

  /**
   * Who was last greeted out loud, and when. The welcome belongs to an
   * ARRIVAL, not to an access row: a student whose decision is suppressed
   * (already recorded, or read again before the gate re-arms) was greeted
   * with silence, which is the complaint this state exists to fix.
   */
  const welcomeRef = useRef<{ id: string; at: number }>({ id: "", at: 0 });

  /**
   * Take the result card down once its readable window has elapsed.
   *
   * The stale-scan reset only clears a card when the oval goes EMPTY, and a
   * student who just presented their face stands there afterwards — so the card
   * used to stay for as long as they did and the next student kept reading the
   * previous name. The decision token keeps a newer card safe from an older
   * timer.
   */
  function scheduleCardRetire(slot: number, token: number) {
    setTimeout(() => {
      if (decisionSeqRef.current !== token) return;
      if (resultCardHolding(cardHoldUntilRef.current, Date.now())) return;
      slotCardsRef.current[slot] = null;
      setSlotPhaseAt(slot, "empty");
    }, RESULT_CARD_MIN_HOLD_MS);
  }

  // ─── Initialization ─────────────────────────────────────

  useEffect(() => {
    if (!started) return;
    initKiosk();
    return () => {
      cleanup();
      // Unsubscribe from gate events to prevent listener leak
      gateCleanupRef.current?.();
      gateCleanupRef.current = null;
    };
  }, [started]);

  // ─── Tap-to-Start ─────────────────────────────────────

  const startingRef = useRef(false);

  async function handleStart() {
    if (started || startingRef.current) return;
    startingRef.current = true;

    // Single user gesture unlocks BOTH camera permission and audio
    unlockAudio();
    primeSpeechVoices();
    try {
      const saved = await getSetting("voice_enabled");
      const enabled = saved !== "false"; // default ON
      setVoiceEnabled(enabled);
      setVoiceOn(enabled);
    } catch {
      /* default ON */
    }
    setStarted(true);
    setShowSplash(false);
  }

  async function initKiosk() {
    try {
      setKioskState("loading_models");
      setStatusMessage("Loading face detection model...");

      // 1. Load AI models — face, recognition, then the uniform torso reader.
      const faceDetectorLoaded = await initFaceDetector().catch(() => false);

      if (!faceDetectorLoaded) {
        setStatusMessage("⚠️ Face detector failed to load");
        setTimeout(() => setKioskState("ready"), 2000);
      }

      setStatusMessage("Loading face recognition model...");
      const recognizerLoaded = await initFaceRecognizer().catch(() => false);

      if (!recognizerLoaded) {
        console.warn("Face recognizer not available, running in detection-only mode");
      }

      // 1b. Uniform model — the CLIP zero-shot torso reader for the dress check.
      // Deliberately NOT awaited. It is an ~89 MB download on the first run, and
      // blocking boot on it held the camera and the face pipeline behind it, so
      // the terminal looked dead (camera on screen, no face detected). It loads
      // in the background now; checkUniform() awaits the in-flight load if a
      // student arrives before it finishes, so enforcement never silently
      // waves anyone through.
      void initUniformDetector()
        .then((loaded) => {
          if (!loaded) {
            console.warn("[Kiosk] Uniform model unavailable — uniform checks deny until it loads");
          }
        })
        .catch(() => {});

      // 2. Hardware first. The gate link, the servo and the physical button
      //    must work whether or not a webcam exists — hardware testing at the
      //    bench is a first-class mode, not a fault state.
      initSupabase();

      // Subscribe before connecting so the very first "connected" event lands.
      // 🔴 Fix #3: Store unsubscribe in a ref (not returned — initKiosk is async)
      gateCleanupRef.current = onGateEvent(handleGateEvent);

      // 3. Try auto-connect gate (Wi-Fi ESP32 first, USB Arduino fallback)
      setStatusMessage("Connecting to gate...");
      if (isGateSupported()) {
        const gateConn = await tryAutoConnect().catch(() => ({
          connected: false,
          transport: null,
        }));
        setGateConnected(gateConn.connected);
        setGateTransport(gateConn.transport);
      }

      // 4. Start camera — optional. Losing it degrades the terminal to a
      //    hardware tester instead of stopping everything in a fault screen.
      setStatusMessage("Starting camera...");
      const cameraOk = await startCamera();
      if (!cameraOk) {
        console.warn("[Kiosk] Camera unavailable — running in hardware test mode");
        setCameraDown(true);
      }

      // 5. Load enrolled faces from IndexedDB
      await refreshEnrolledFaces();

      // 6. Try background sync
      syncInBackground();

      // 7. Start main loop (it idles harmlessly without camera frames)
      setKioskState("ready");
      setStatusMessage(cameraOk ? "Ready" : "Camera unavailable — hardware test mode");
      startMainLoop();

      // 9. Start health heartbeat (every 60s while online)
      startHeartbeat(sendHeartbeatTick);

      // Load settings from IndexedDB (may have been synced previously)
      await loadSettingsFromDb();
    } catch (err) {
      console.error("Init error:", err);
      setKioskState("error");
      setStatusMessage(`Initialization error: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  // ─── Camera ─────────────────────────────────────────────

  async function startCamera(): Promise<boolean> {
    try {
      // Ask for the same resolution the enrollment stations capture at. A
      // downscaled frame is fine (letterboxing to 640 costs nothing) but a
      // SOFT frame is fatal: measured on a laboratory test image the dress-code
      // model scores 95% sharp, 57% at 2px of blur, and then flips to an
      // entirely wrong uniform by 3px before detecting nothing at all.
      // A permission prompt the user never answers (or a missing device that
      // never rejects) must not stall boot forever: hardware testing has to
      // keep working even when the camera is absent.
      const cameraRequest = navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "environment",
          frameRate: { ideal: 30 },
        },
      });

      let stream: MediaStream;
      try {
        stream = await Promise.race([
          cameraRequest,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Camera start timed out")), CAMERA_START_TIMEOUT_MS),
          ),
        ]);
      } catch (err) {
        // Access may still be granted after we gave up waiting — release it so
        // the camera indicator does not stay lit.
        void cameraRequest
          .then((late) => late.getTracks().forEach((track) => track.stop()))
          .catch(() => {});
        throw err;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }

      // Wait for video to be ready
      await new Promise<void>((resolve) => {
        const video = videoRef.current;
        if (!video) return resolve();
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
        // Fallback in case onloadedmetadata doesn't fire
        setTimeout(resolve, 1000);
      });

      return true;
    } catch (err) {
      console.error("Camera error:", err);
      return false;
    }
  }

  // ─── Main AI Loop ───────────────────────────────────────

  function startMainLoop() {
    let frameCount = 0;

    async function loop() {
      // 🔴 FIX BUG #1: Use ref instead of stale closure state
      if (kioskStateRef.current === "error") {
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const overlayCanvas = overlayCanvasRef.current;

      if (!video || !canvas || !overlayCanvas) {
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      if (video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      // Sync canvas sizes. The overlay is pinned to the video's *painted* box
      // (object-fit: cover) so its normalized coordinates line up 1:1.
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      if (overlayCanvas.width !== video.videoWidth) overlayCanvas.width = video.videoWidth;
      if (overlayCanvas.height !== video.videoHeight) overlayCanvas.height = video.videoHeight;
      const overlayBox = syncOverlayToVideo(overlayCanvas, video);
      // The oval is drawn in camera-frame coordinates but seen through a cropped
      // window, so its width is derived from how much of the frame is on screen.
      if (overlayBox) {
        zonesRef.current = [
          standingZoneFor({
            frameWidth: video.videoWidth,
            frameHeight: video.videoHeight,
            boxWidth: overlayBox.width,
            viewportWidth: window.innerWidth,
          }),
        ];
      }

      frameCount++;

      // ─── 1. Face detection — fast cadence ─────────────────
      // MediaPipe face detection is ~5ms, so run it every other frame and let
      // the overlay track the face smoothly. Publish the live phase too.
      if (frameCount % 2 === 0) {
        const faces = detectFaces(video, canvas);
        lastFacesRef.current = faces;

        if (faces.length > 0) {
          lastFaceAtRef.current = Date.now();
        }

        if (kioskStateRef.current === "ready" || kioskStateRef.current === "scanning") {
          if (faces.length > 0) {
            // Advance to "face" but never regress a phase that is already
            // deeper into the pipeline (verify/done), which would make
            // the HUD flicker backwards while a check is running.
            setScanStep((prev) => (prev === "verify" || prev === "done" ? prev : "face"));
          } else if (Date.now() - lastFaceAtRef.current > 900) {
            // Nobody in frame — back to looking, so a stale verdict never sits
            // on screen after the person walks away.
            setScanStep("searching");
          }
        }

        // FPS = face-detection ticks per second (the vision loop's real rate).
        fpsRef.current++;
        const tick = Date.now();
        if (tick - lastFpsTime.current >= 1000) {
          setFps(fpsRef.current);
          fpsRef.current = 0;
          lastFpsTime.current = tick;
        }
      }

      // ─── 2. Recognition — throttled ───────────────────────
      // ArcFace + YOLO cost a few hundred ms. Running them on a fixed interval
      // (instead of every frame) keeps detection smooth and stops the reticle
      // from stalling while a check is in flight.
      const detected = lastFacesRef.current;

      // ─── Presence tracking (re-arm) ─────────────────────
      // Tracks whether the gate area has been truly EMPTY since the last
      // decision (≥ REARM_ABSENCE_MS — a blink or one dropped frame doesn't
      // count). This no longer blocks the scanner: recognition runs for
      // whoever is in frame, and the per-IDENTITY decision gate lives inside
      // processFace, so a brand-new student is decided immediately even while
      // the previous student's notice is still on screen.
      const presence = nextPresence({
        facePresent: detected.length > 0,
        state: { faceFreeSince: faceFreeSinceRef.current, rearmed: frameClearedRef.current },
        now: Date.now(),
      });
      faceFreeSinceRef.current = presence.faceFreeSince;
      frameClearedRef.current = presence.rearmed;
      // Somebody is here: the next absence earns a fresh reset.
      if (detected.length > 0) staleClearedRef.current = false;

      // ─── Stale-scan reset ─────────────────────────────
      // The frame has been truly empty for a beat: whoever was standing here
      // walked on. Take down a settled "unknown face" card, drop any
      // half-built confirmation, and restart the unknown dwell clock — the
      // next arrival must be read as someone new, never inherit the last
      // visitor's verdict-in-progress.
      // Once per absence, not once per frame — see staleClearedRef.
      if (
        shouldClearStaleScan({ faceFreeSince: faceFreeSinceRef.current, now: Date.now() }) &&
        !staleClearedRef.current
      ) {
        staleClearedRef.current = true;
        unknownSinceRef.current = 0;
        faceWindowRef.current = [{ ...EMPTY_FACE_WINDOW }, { ...EMPTY_FACE_WINDOW }];
        // The QR signal is NOT cleared here: a student presents a code with
        // nobody in the oval, so "the oval is empty" says nothing about their
        // ID. It expires on its own freshness window (QR_FRESH_MS) instead.
        setConfirmProgress(0);
        if (confirmedRef.current) {
          confirmedRef.current = null;
          setConfirmed(null);
        }
        setUnknownNotice(null);
        // The visitor walked on: the next face in this oval is a new arrival
        // and earns its own welcome.
        welcomeRef.current = { id: "", at: 0 };
        // ...but never the card that is still inside its guaranteed hold:
        // "the oval is empty" is the normal state of a QR entry, not proof
        // that the student has walked away from their receipt.
        if (!resultCardHolding(cardHoldUntilRef.current, Date.now())) {
          slotCardsRef.current = [null, null];
          setSlotPhases(["empty", "empty"]);
          setSlotDetails(["", ""]);
        }
      }

      // The decision notice is retired by WHO is on screen now, not just by
      // the clock. It lives its full one-minute window while its own student
      // stands there (a momentary step-out does not retract "you are already
      // recorded"), but clears when: the window elapses, the frame has been
      // empty a while (that student walked on), or a DIFFERENT live identity
      // is being read — so a new visitor never faces a stranger's name.
      if (holdNoticeRef.current) {
        const notice = holdNoticeRef.current;
        const expired = Date.now() - notice.at >= NOTICE_WINDOW_MS;
        const studentWalkedOn =
          detected.length === 0 &&
          faceFreeSinceRef.current !== 0 &&
          Date.now() - faceFreeSinceRef.current >= NOTICE_ABSENCE_CLEAR_MS;
        const liveMatch = lastMatchRef.current;
        const someoneElse =
          notice.personId != null &&
          liveMatch?.person != null &&
          liveMatch.person.id !== notice.personId;
        const strangerSettled =
          notice.personId != null &&
          liveMatch != null &&
          !liveMatch.matched &&
          isSettledUnknown({
            matched: false,
            firstSeenAt: unknownSinceRef.current,
            now: Date.now(),
          });
        // Past its window the notice may only retire once nobody is standing
        // there — a student who never leaves keeps an honest "recorded" on
        // screen instead of a contradiction.
        if ((expired && detected.length === 0) || studentWalkedOn || someoneElse || strangerSettled)
          setHoldNotice(null);
      }

      // ─── School-ID QR ────────────────────────────
      // Decoded from the canvas the detector just drew, at ~3 Hz: fast enough
      // to catch a code held up for a moment, cheap enough that recognition
      // keeps its frame budget.
      if (settingsRef.current.allowQr && Date.now() - lastQrDecodeRef.current >= 300) {
        lastQrDecodeRef.current = Date.now();
        // One oval, one read region: the whole frame. decodeStudentQr retries
        // with an inverted and a contrast-stretched copy, because a phone screen
        // held up in a lobby is dim and glarey, not the crisp image a decoder
        // gets from a printed label.
        const scanned = decodeStudentQr(canvas);
        if (scanned) {
          const signal = { studentId: scanned, seenAt: Date.now() };
          qrSlotsRef.current[0] = signal;
          setQrSeen(signal);
        }
      }

      // School-ID QR entry is a first-class choice, not only a fallback: a
      // student may present their ID instead of standing for the camera, and the
      // gate opens either way. This runs with no face in frame at all.
      if (
        settingsRef.current.allowQr &&
        (qrSlotsRef.current[0] || qrSlotsRef.current[1]) &&
        !processingRef.current &&
        Date.now() - lastQrAttemptRef.current >= 800
      ) {
        lastQrAttemptRef.current = Date.now();
        processingRef.current = true;
        try {
          await tryQrEntry(0);
        } catch (err) {
          console.error("QR entry error:", err);
        } finally {
          processingRef.current = false;
        }
      }

      if (
        detected.length > 0 &&
        !processingRef.current &&
        // Recognition runs through the verdict card too — a new arrival must
        // not wait out the previous student's 8s card before being read. The
        // loop's early return already excludes the error state; these drop
        // the pre-ready boot states and the offline splash.
        (kioskStateRef.current === "ready" ||
          kioskStateRef.current === "scanning" ||
          kioskStateRef.current === "granted" ||
          kioskStateRef.current === "denied") &&
        Date.now() - lastRecognizedAtRef.current >= RECOGNIZE_INTERVAL_MS
      ) {
        lastRecognizedAtRef.current = Date.now();
        processingRef.current = true;
        try {
          // Only the person standing in the oval is read. Anyone behind them —
          // a queue, a passer-by — is outside the zone and ignored, which is
          // what stops the wrong person from being named.
          const assigned = assignFacesToSlots(detected, zonesRef.current);
          for (const { face, slot } of assigned) {
            await processFace(face, slot, video, canvas);
          }
        } catch (err) {
          console.error("Process error:", err);
        } finally {
          processingRef.current = false;
        }
      }

      // Draw the HUD on every frame (not just every 3rd inference frame) so the
      // guide and scan sweep animate smoothly instead of stuttering at ~7 FPS.
      drawOverlays(overlayCanvas);

      animFrameRef.current = requestAnimationFrame(loop);
    }

    animFrameRef.current = requestAnimationFrame(loop);
  }

  // ─── Face Processing ────────────────────────────────────

  /**
   * School-ID QR entry \u2014 a first-class alternative to the camera.
   *
   * Either method opens the gate: a student may look at the camera OR present
   * their ID, and neither is a second factor for the other. The only overlap
   * rule is the two-second guard below — a face that just matched already owns
   * this decision, so the code cannot log the same student twice. An unenrolled
   * code is reported honestly instead of being ignored.
   */
  async function tryQrEntry(slot: number) {
    const signal = qrSlotsRef.current[slot];
    if (!signal || qrHandledAtRef.current[slot] >= signal.seenAt) return;

    // An empty roster is not a verdict. Before the first sync the list is empty,
    // and evaluating against it denied every real student as "not enrolled" and
    // wrote a failure row. Reload once, then say honestly that it is not ready.
    if (qrRosterRef.current.length === 0) {
      await updateEnrollmentHealth().catch(() => {});
      if (qrRosterRef.current.length === 0) {
        setStatusMessage("Student list still syncing - try your ID again in a moment");
        return;
      }
    }

    const outcome = evaluateScannedQr({
      allowQr: settingsRef.current.allowQr,
      qr: signal,
      now: Date.now(),
      // The whole active roster, not the face matcher's list: a student with no
      // face template can still present their ID and go through.
      enrolledStudentIds: qrRosterRef.current.map((s) => s.student_id),
    });
    if (outcome.code === "DISABLED" || outcome.code === "NO_CODE") return;
    if (outcome.code === "STALE") {
      qrSlotsRef.current[slot] = null;
      setQrSeen(null);
      return;
    }
    // A face that already matched owns this decision \u2014 never double-log.
    if (Date.now() - slotMatchedAtRef.current[slot] < 2000) return;

    qrHandledAtRef.current[slot] = signal.seenAt;

    if (outcome.code === "UNKNOWN") {
      const personId = `qr:${outcome.studentId}`;
      // Re-read every few hundred ms while the code is held up: one decision
      // per minute, like every other path.
      const prevUnknown = lastDecisionByPersonRef.current.get(personId);
      if (prevUnknown && isRepeatDecision({ lastDecisionAt: prevUnknown.at, now: Date.now() })) return;
      lastDecisionByPersonRef.current.set(personId, { at: Date.now(), granted: false });
      const detail = "School ID not enrolled \u2014 see the guard station";
      ++decisionSeqRef.current;
      setKioskState("denied");
      playCue("deny");
      setStatusMessage(detail);
      setHoldNotice({ kind: "denied", name: outcome.studentId, at: Date.now(), personId, detail });
      rememberDecision(outcome.studentId, personId, false);
      setSlotPhaseAt(slot, "denied", detail);
      cardHoldUntilRef.current = Date.now() + RESULT_CARD_MIN_HOLD_MS;
      faceWindowRef.current[slot] = { ...EMPTY_FACE_WINDOW };
      scheduleCardRetire(slot, decisionSeqRef.current);
      await addLog({
        person_id: null,
        person_name: outcome.studentId,
        person_type: "student",
        direction: "entry",
        method: "qr",
        success: false,
        confidence: 0,
        failure_reason: detail,
        reason_code: "QR_UNKNOWN",
        decision_note: detail,
        client_id: "kiosk-01",
        gate_state: "closed",
        device_timestamp: new Date().toISOString(),
      }).catch((err) => console.warn("[Kiosk] Log write failed:", err));
      refreshStats();
      setTimeout(() => {
        setKioskState("ready");
        setStatusMessage("Ready");
        setScanStep("searching");
      }, VERDICT_HOLD_MS);
      return;
    }

    const person = qrRosterRef.current.find(
      (s) => normalizeStudentId(s.student_id) === normalizeStudentId(outcome.studentId),
    );
    if (!person) return;

    // Lockdown outranks every entry method. The camera path denies it, so the
    // school ID must not be the side door that opens the gate during one.
    if (settingsRef.current.lockdownMode) {
      const detail = settingsRef.current.lockdownReason
        ? `Campus lockdown - ${settingsRef.current.lockdownReason}`
        : "Campus lockdown - see guard";
      const lockedPrev = lastDecisionByPersonRef.current.get(person.id);
      if (lockedPrev && isRepeatDecision({ lastDecisionAt: lockedPrev.at, now: Date.now() })) return;
      lastDecisionByPersonRef.current.set(person.id, { at: Date.now(), granted: false });
      const lockedToken = ++decisionSeqRef.current;
      setKioskState("denied");
      playCue("deny");
      setStatusMessage(detail);
      slotCardsRef.current[slot] = {
        id: person.id,
        name: person.name,
        department: person.department ?? "",
        confidence: 0,
      };
      setSlotPhaseAt(slot, "denied", detail);
      setHoldNotice({
        kind: "denied",
        name: person.name,
        at: Date.now(),
        personId: person.id,
        detail,
      });
      rememberDecision(person.name, person.id, false);
      cardHoldUntilRef.current = Date.now() + RESULT_CARD_MIN_HOLD_MS;
      scheduleCardRetire(slot, lockedToken);
      await addLog({
        person_id: person.id,
        person_name: person.name,
        person_type: "student",
        direction: "entry",
        method: "qr",
        success: false,
        confidence: 0,
        failure_reason: detail,
        reason_code: "LOCKDOWN_ACTIVE",
        decision_note: `${detail} - school ID QR`,
        client_id: "kiosk-01",
        gate_state: "closed",
        device_timestamp: new Date().toISOString(),
      }).catch((err) => console.warn("[Kiosk] Log write failed:", err));
      refreshStats();
      setTimeout(() => {
        if (decisionSeqRef.current !== lockedToken) return;
        setKioskState("ready");
        setStatusMessage("Ready");
        setScanStep("searching");
      }, VERDICT_HOLD_MS);
      return;
    }

    const prev = lastDecisionByPersonRef.current.get(person.id);
    if (prev?.granted && isRepeatDecision({ lastDecisionAt: prev.at, now: Date.now() })) {
      setHoldNotice({ kind: "granted", name: person.name, at: prev.at, personId: person.id });
      return;
    }

    const cardToken = ++decisionSeqRef.current;
    setKioskState("granted");
    playCue("grant");
    setStatusMessage(`Welcome, ${person.name}!`);
    setVerdict({ person, confidence: 0, isGuest: false });
    setScanStep("done");
    slotCardsRef.current[slot] = {
      id: person.id,
      name: person.name,
      department: person.department ?? "",
      confidence: 0,
    };
    setSlotPhaseAt(slot, "granted");

    const gateConnectedNow = gateConnectedRef.current;
    if (gateConnectedNow) {
      await openGate().catch((err) => console.warn("[Kiosk] Gate open failed:", err));
    }
    const gateConfirmed = gateConnectedNow
      ? await confirmGateOpen(3000).catch(() => false)
      : false;
    const gateOutcome = resolveGateOutcome({
      gateConnected: gateConnectedNow,
      confirmed: gateConfirmed,
    });
    setGateState(gateOutcome);
    const gateOpenSeconds = clampGateWindow(settingsRef.current.gateOpenDuration);
    setGateSecondsLeft(gateOpenSeconds);
    gateBannerUntilRef.current = Date.now() + gateOpenSeconds * 1000;

    frameClearedRef.current = false;
    const grantedAt = Date.now();
    // Guarantee the name + course are readable for the full window: the oval is
    // empty on a QR entry, so nothing else keeps this card on screen.
    cardHoldUntilRef.current = grantedAt + RESULT_CARD_MIN_HOLD_MS;
    // This student's evidence is spent; the next arrival starts a fresh window
    // instead of inheriting an average that has already been decided.
    faceWindowRef.current[slot] = { ...EMPTY_FACE_WINDOW };
    scheduleCardRetire(slot, cardToken);
    lastDecisionByPersonRef.current.set(person.id, { at: grantedAt, granted: true });
    rememberDecision(person.name, person.id, true);
    setHoldNotice({
      kind: "granted",
      name: person.name,
      at: grantedAt,
      personId: person.id,
    });

    await addLog({
      person_id: person.id,
      person_name: person.name,
      person_type: "student",
      direction: "entry",
      method: "qr",
      success: true,
      confidence: 0,
      failure_reason: "School ID QR verified \u2014 face not required",
      reason_code: "QR_PASS",
      decision_note: `School ID QR ${person.student_id} verified \u2014 face not required`,
      client_id: "kiosk-01",
      gate_state: gateStateForLog({ gateConnected: gateConnectedNow, confirmed: gateConfirmed }),
      device_timestamp: new Date().toISOString(),
    }).catch((err) => console.warn("[Kiosk] Log write failed:", err));
    refreshStats();
    updateEnrollmentHealth?.();

    if (gateConnectedNow) {
      setTimeout(() => {
        closeGate().catch((err) => console.warn("[Kiosk] Gate close failed:", err));
      }, gateOpenSeconds * 1000);
    }

    setTimeout(() => {
      if (decisionSeqRef.current !== cardToken) return;
      setKioskState("ready");
      setStatusMessage("Ready");
      setVerdict(null);
      setLastMatch(null);
      setScanStep("searching");
      if (gateBannerUntilRef.current === 0 || Date.now() >= gateBannerUntilRef.current) {
        setGateState(null);
        setGateSecondsLeft(null);
      }
    }, VERDICT_HOLD_MS);
  }

  async function processFace(
    face: FaceResult,
    slot: number,
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
  ) {
    // Too far away to score: a 40-pixel face embeds as noise and noise matches
    // whoever it happens to be closest to.
    if (faceTooSmall(face.bbox)) {
      setScanStep("face");
      setStatusMessage("Step closer — hold still inside the frame");
      return;
    }

    // Get face embedding
    const embedding = await getFaceEmbedding(video, face.bbox, canvas);
    if (!embedding) return;

    // A result card inside its guaranteed hold OWNS the panel. Lowering the ID
    // puts the student's own face — or a moving arm — into the oval, and this
    // path used to repaint the slot as "verifying" / "unknown" the instant that
    // happened, blanking the name they were still reading. Recognition keeps
    // running; it just may not touch the card until the hold elapses.
    const cardHoldActive = resultCardHolding(cardHoldUntilRef.current, Date.now());

    // Match against enrolled faces
    let match = matchFace(embedding, enrolledRef.current, settingsRef.current.matchThreshold);
    lastMatchRef.current = match;
    lastMatchAtRef.current = Date.now();
    if (match.matched) slotMatchedAtRef.current[slot] = Date.now();
    setLastMatch(match);

    // A below-threshold read is not a verdict yet. The first frames of a
    // walk-up are in motion and measure far under the person's real similarity
    // (0.26 before settling at 0.63), so the dwell clock has to run out before
    // this counts as an unrecognised visitor. Until then the rail stays in its
    // neutral "hold still" state instead of flashing a low score.
    if (match.matched) {
      unknownSinceRef.current = 0;
    } else if (unknownSinceRef.current === 0) {
      unknownSinceRef.current = Date.now();
    }
    const settledUnknown = isSettledUnknown({
      matched: match.matched,
      firstSeenAt: unknownSinceRef.current,
      now: Date.now(),
    });

    // Publish the phase for the on-screen pipeline: identity is resolved, so
    // either we are verifying the decision or this face is unknown.
    setScanStep(match.matched ? "verify" : settledUnknown ? "done" : "face");
    if (settledUnknown && !match.matched && !cardHoldActive) {
      setSlotPhaseAt(slot, "unknown", `${Math.max(0, Math.round(match.confidence * 100))}% closest`);
    }

    // ─── Unknown-visitor notice (settled, still no match) ──
    // Surfaced here — ahead of every early-return below — so a stranger always
    // gets an honest "not enrolled" card instead of silence. Never shows a name.
    if (settledUnknown && !match.matched && !cardHoldActive) {
      setUnknownNotice((prev) =>
        prev
          ? { score: match.confidence, at: prev.at }
          : { score: match.confidence, at: Date.now() },
      );
      const beep = shouldPlayBeep(lastUnknownBeepRef.current, Date.now());
      lastUnknownBeepRef.current = beep.lastPlayedAt;
      if (beep.play) playCue("unknown");
    } else if (match.matched) {
      // Same-value bail-out: no-op when already null, so no extra renders.
      setUnknownNotice(null);
    }

    // ─── Three-second best-match window ─────────────────
    // One frame is not evidence. At walk-up speed the first frames score the
    // right student at 0.26, and a motion-blurred frame can score a stranger at
    // 0.61 — so nobody is named until the window closes.
    //
    // Every matched tick is collected and the identity with the best AVERAGE
    // score wins. It used to require the SAME identity to win consecutive
    // ticks, so one flicker towards a lookalike discarded everything already
    // collected and restarted the count: the correct student's name arrived
    // late, or never. `confirmed` is now retired only when the oval empties,
    // instead of blinking off on every flickered frame.
    const sampledAt = Date.now();
    let window = faceWindowRef.current[slot];
    if (window.startedAt === 0) window = startFaceWindow(sampledAt);
    if (match.matched && match.person) {
      window = recordFaceSample(window, {
        id: match.person.id,
        score: match.confidence,
        at: sampledAt,
      });
    }
    faceWindowRef.current[slot] = window;
    setConfirmProgress(
      window.startedAt === 0 ? 0 : Math.min(FACE_MATCH_WINDOW_MS, sampledAt - window.startedAt),
    );

    if (!faceWindowElapsed(window, sampledAt)) {
      // Still gathering: show progress, never a name — unless a result card is
      // still inside its hold, in which case that card stays exactly as it is.
      // A student who already passed keeps hearing "hold still" otherwise:
      // their notice is live, so leave the panel neutral while it shows.
      if (!cardHoldActive && !holdNoticeRef.current) {
        slotCardsRef.current[slot] = null;
        setSlotPhaseAt(slot, "verifying");
      }
      return;
    }

    const best = bestFaceInWindow(window);
    const bestPerson = best ? (enrolledRef.current.find((s) => s.id === best.id) ?? null) : null;
    // Naming someone takes three things: enough reads to be evidence, a score
    // over the threshold, and a clear lead over the next-closest profile. The
    // lead was computed nowhere — "ambiguous" was returned and never read — so
    // a lookalike, or a second enrolled student behind the one at the kiosk, won
    // the window by a hair and the card showed the wrong name.
    const tooClose =
      best !== null && best.runnerUp >= 0 && best.score - best.runnerUp < AMBIGUOUS_GAP;
    if (
      !best ||
      !bestPerson ||
      best.samples < MIN_FACE_SAMPLES ||
      best.score < settingsRef.current.matchThreshold ||
      tooClose
    ) {
      // Evidence ran out without a clear winner: this is an unrecognised
      // visitor, and the unknown-dwell card owns the screen.
      if (!cardHoldActive) slotCardsRef.current[slot] = null;
      return;
    }

    // The winner is the identity with the best average across the window, so
    // everything downstream (verdict → log → gate) names that student.
    match = { ...match, matched: true, person: bestPerson, confidence: best.score };
    // Publish it as the live match too: the rail names an identity only when
    // the last read and the confirmed one agree, and the last read here was a
    // single below-threshold frame.
    lastMatchRef.current = match;
    setLastMatch(match);

    // This is the window's winner: the one name and course the HUD may show.
    if (match.person && (!confirmedRef.current || confirmedRef.current.id !== match.person.id)) {
      const c = {
        id: match.person.id,
        name: match.person.name,
        confidence: match.confidence,
      };
      confirmedRef.current = c;
      setConfirmed(c);
    }
    // ─── Welcome, every single arrival ─────────────────
    // Said here — on recognition — and not in the grant branch below, because
    // the decision gate deliberately suppresses repeat rows: a student recorded
    // a moment ago, or one read again before the gate re-armed, still walked up
    // and should still be greeted. Throttled per person so one visit isn't
    // greeted on every frame.
    if (match.person) {
      const greetedAt = Date.now();
      if (shouldAnnounceWelcome(welcomeRef.current, match.person.id, greetedAt)) {
        welcomeRef.current = { id: match.person.id, at: greetedAt };
        playCue("grant");
      }
    }

    // No card here: a name belongs to a DECISION, not to a read. Writing one at
    // this point made a standing student's name reappear every time their window
    // closed, never expire while they stayed, and shadow whoever came next. The
    // grant branch below is the only place the card is written.

    // ─── Per-identity decision gate ─────────────────────
    // Recognition always runs (the HUD and identity phase above track whoever
    // is in frame); THIS decides whether the person in frame may go through
    // the full decision pipeline (uniform → verdict → log → gate). The prior
    // decision is looked up FOR THE IDENTITY IN FRAME: a brand-new student
    // has none and is decided immediately — even while the previous
    // student's "already recorded" notice is still up — while the same
    // student lingering at the gate is decided once per stay.
    if (
      !shouldDecide({
        lastDecisionAt: match.person
          ? (lastDecisionByPersonRef.current.get(match.person.id)?.at ?? 0)
          : 0,
        frameEmptySinceLastDecision: frameClearedRef.current,
        now: Date.now(),
      })
    ) {
      return;
    }

    // Already recorded — the whole point of the one-minute window. A person
    // returning inside it (dart out for 5s, tie a shoelace, step back) is
    // shown the "proceed to the gate" notice again, anchored to their ORIGINAL
    // decision time, and the full grant sequence never runs: no second card,
    // no gate command, no second access row. Only a fresh arrival after the
    // window (afternoon class) earns a new scan. This suppression is keyed to
    // the person IN FRAME, so it never blocks a different student.
    if (match.matched && match.person) {
      const prev = lastDecisionByPersonRef.current.get(match.person.id);
      if (prev?.granted && isRepeatDecision({ lastDecisionAt: prev.at, now: Date.now() })) {
        setHoldNotice({
          kind: "granted",
          name: match.person.name,
          at: prev.at,
          personId: match.person.id,
        });
        return;
      }
    }

    // Guests are flagged by their uniform_type marker (data convention only).
    const isGuestMatch = match.matched && match.person?.uniform_type === 'guest';

    // Uniform check — students only, guests skip it (no uniform requirement).
    // The torso band under the named face goes to the YOLO model and the
    // detected course family must match theirs (any CICI uniform verifies a
    // CICI student). A missing or failing detector fails closed — waving
    // everyone through would make the admin toggle a lie.
    let uniformCheck: UniformCheckResult | null = null;
    if (match.matched && match.person && settingsRef.current.uniformEnabled && !isGuestMatch) {
      // Publish the torso band being read so the overlay draws the "what I am
      // reading" box while YOLO runs, and say so on the status line. Cleared
      // the moment the check settles (grant/deny branches overwrite the text).
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 640;
      const band = torsoRegion(face.bbox, { videoWidth: vw, videoHeight: vh });
      uniformScanRef.current = {
        bbox: [band.x / vw, band.y / vh, band.width / vw, band.height / vh],
        until: Date.now() + 10000,
      };
      setStatusMessage("Reading uniform…");
      uniformCheck = await checkUniform(
        video,
        face.bbox,
        match.person.uniform_type ?? "",
        canvas,
      ).catch(
        (): UniformCheckResult => ({ ok: false, confidence: 0, detail: "Uniform detector unavailable" }),
      );
      uniformScanRef.current = null;
    }
    const uniformFailed = uniformCheck !== null && uniformCheck.ok !== true;

    // Determine access (lockdown > guest expiry > uniform > face+policy).
    const locked = settingsRef.current.lockdownMode;
    let guestExpired = false;
    let guestExpiryLabel = '';
    if (isGuestMatch) {
      const raw = (match.person as { valid_until?: string | null })?.valid_until;
      const pass = evaluateGuestPass(raw, Date.now());
      guestExpired = pass.expired;
      guestExpiryLabel = pass.expiryLabel;
    }
    const denyReason = !match.matched
      ? null
      : locked
        ? { code: 'LOCKDOWN_ACTIVE', note: settingsRef.current.lockdownReason ? `Campus lockdown — ${settingsRef.current.lockdownReason}` : 'Campus lockdown — see guard' }
        : guestExpired
          ? { code: 'GUEST_EXPIRED', note: `Guest pass expired${guestExpiryLabel ? ` ${guestExpiryLabel}` : ''} — see guard to renew` }
          : uniformFailed
            ? {
                code: uniformCheck!.detectedType ? 'WRONG_UNIFORM' : 'NO_UNIFORM',
                note: uniformCheck!.detail,
              }
            : null;
    const accessGranted = match.matched && !denyReason;

    if (accessGranted) {
      // Grant access — the card timer must know it owns the screen (a new
      // decision can land while this card's hold window is still running).
      const cardToken = ++decisionSeqRef.current;
      setKioskState("granted");
      // No cue here: the recognition path above already greeted this arrival,
      // and a second play would cut the recording off and start it over.
      setStatusMessage(`Welcome, ${match.person!.name}!`);
      // Freeze the card identity: recognition keeps overwriting lastMatch
      // while the card is up, so the card reads from this snapshot and the
      // name survives the person stepping out of frame for the full hold.
      setVerdict({
        person: match.person!,
        confidence: match.confidence,
        isGuest: isGuestMatch,
        uniformDetail: uniformCheck?.detail ?? null,
      });
      setSlotPhaseAt(slot, "granted");
      // Name + course for the card, taken from the identity that was decided.
      slotCardsRef.current[slot] = {
        id: match.person!.id,
        name: match.person!.name,
        department: match.person!.department ?? "",
        confidence: match.confidence,
        uniform: uniformCheck?.detail ?? null,
      };

      // Open gate (Wi-Fi ESP32 or USB Arduino)
      // 🔴 FIX BUG #1: Use ref for gate state check
      if (gateConnectedRef.current) {
        await openGate().catch((err) => console.warn("[Kiosk] Gate open failed:", err));
      }

      // 🔴 FEEDBACK LOOP: confirm the gate actually opened (max 3s)
      //
      // Three honest outcomes, because showing nothing made an unwired gate look
      // like a broken gate: OPEN (controller confirmed), AWAITING (linked but
      // silent), SENT (no controller linked — command issued, demo mode).
      const gateConnectedNow = gateConnectedRef.current;
      const gateConfirmed = gateConnectedNow
        ? await confirmGateOpen(3000).catch(() => false)
        : false;
      const gateOutcome = resolveGateOutcome({
        gateConnected: gateConnectedNow,
        confirmed: gateConfirmed,
      });
      setGateState(gateOutcome);
      const gateOpenSeconds = clampGateWindow(settingsRef.current.gateOpenDuration);
      const gateOpenMs = gateOpenSeconds * 1000;
      setGateSecondsLeft(gateOpenSeconds);
      gateBannerUntilRef.current = Date.now() + gateOpenMs;
      setStatusMessage(
        gateConfirmed
          ? `Welcome, ${match.person!.name}! Gate OPEN`
          : `Welcome, ${match.person!.name}!`,
      );

      // 🛡️ Duplicate guard — a lingering student (or one who steps out and
      // straight back in) must not produce a second access row. The decision
      // starts a new stay: the "frame cleared" flag resets so this identity
      // is decided once more only after they genuinely leave again.
      frameClearedRef.current = false;
      const grantedAt = Date.now();
      // Same guarantee as a QR entry: the student often steps back as the gate
      // opens, and the card must survive that for a readable beat.
      cardHoldUntilRef.current = grantedAt + RESULT_CARD_MIN_HOLD_MS;
      // The card comes down on its own after the hold, even though this student
      // is still standing there; their samples must not decide the next one.
      faceWindowRef.current[slot] = { ...EMPTY_FACE_WINDOW };
      scheduleCardRetire(slot, cardToken);
      const isRepeatGrant = isRepeatDecision({
        lastDecisionAt: lastDecisionByPersonRef.current.get(match.person!.id)?.at ?? 0,
        now: grantedAt,
      });
      if (!isRepeatGrant)
        lastDecisionByPersonRef.current.set(match.person!.id, { at: grantedAt, granted: true });
      rememberDecision(match.person!.name, match.person!.id, true);
      setHoldNotice({
        kind: "granted",
        name: match.person!.name,
        at: grantedAt,
        personId: match.person!.id,
      });

      // Log access (015 explainable: reason_code + decision_note)
      if (!isRepeatGrant) {
        const passNote = isGuestMatch
          ? (() => {
            const p = match.person as { host_name?: string | null; valid_until?: string | null };
            const exp = p.valid_until ? ` valid until ${new Date(p.valid_until).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
            return `Guest pass${p.host_name ? ` host ${p.host_name}` : ""}${exp} — face verified`;
          })()
          : uniformCheck
            ? `Uniform verified — ${uniformCheck.detail}`
            : "Granted — uniform check disabled in settings";
        await addLog({
          person_id: match.person!.id,
          person_name: match.person!.name,
          person_type: isGuestMatch ? "guest" : "student",
          direction: "entry",
          method: "face",
          success: true,
          confidence: match.confidence,
          failure_reason: passNote,
          uniform_ok: isGuestMatch ? null : (uniformCheck?.ok ?? null),
          reason_code: isGuestMatch ? "GUEST_PASS_VALID" : "POLICY_PASS",
          decision_note: passNote,
          client_id: "kiosk-01",
          gate_state: gateStateForLog({
            gateConnected: gateConnectedNow,
            confirmed: gateConfirmed,
          }),
          device_timestamp: new Date().toISOString(),
        }).catch((err) => console.warn("[Kiosk] Log write failed:", err));
      }

      // Update stats
      refreshStats();

      // Release the barrier when its configured open window elapses.
      if (gateConnectedNow) {
        setTimeout(() => {
          closeGate().catch((err) => console.warn("[Kiosk] Gate close failed:", err));
        }, gateOpenMs);
      }

      // Cooldown before next scan — token-guarded: if a NEW decision took
      // over the screen while this card was holding, this older timer must
      // not wipe the new verdict.
      setTimeout(() => {
        if (decisionSeqRef.current !== cardToken) return;
        setKioskState("ready");
        setStatusMessage("Ready");
        setLastMatch(null);
        setVerdict(null);
        // Reset the phase so the rail never sticks on a stale step while idle.
        setScanStep("searching");
        // The barrier banner outlives the verdict card when the configured
        // open window is longer than the card hold — clear it only once the
        // window has actually elapsed (the countdown effect handles the rest).
        if (gateBannerUntilRef.current === 0 || Date.now() >= gateBannerUntilRef.current) {
          setGateState(null);
          setGateSecondsLeft(null);
        }
      }, VERDICT_HOLD_MS);
    } else if (match.matched && denyReason) {
      // Denied by policy: lockdown > expired pass.
      const detail = denyReason.note;
      const code = denyReason.code;
      const cardToken = ++decisionSeqRef.current;
      setKioskState("denied");
      playCue("deny");
      setStatusMessage(detail);
      setVerdict({
        person: match.person!,
        confidence: match.confidence,
        isGuest: false,
        uniformDetail: uniformFailed ? (uniformCheck?.detail ?? null) : null,
      });
      setSlotPhaseAt(slot, "denied", detail);
      cardHoldUntilRef.current = Date.now() + RESULT_CARD_MIN_HOLD_MS;
      faceWindowRef.current[slot] = { ...EMPTY_FACE_WINDOW };
      scheduleCardRetire(slot, cardToken);

      // Same duplicate guard as a grant: a denial must not be
      // re-logged every few seconds while the student stands there. The
      // decision starts a new stay for this identity.
      frameClearedRef.current = false;
      const deniedAt = Date.now();
      const isRepeatDenial = isRepeatDecision({
        lastDecisionAt: lastDecisionByPersonRef.current.get(match.person!.id)?.at ?? 0,
        now: deniedAt,
      });
      if (!isRepeatDenial)
        lastDecisionByPersonRef.current.set(match.person!.id, { at: deniedAt, granted: false });
      rememberDecision(match.person!.name, match.person!.id, false);
      setHoldNotice({
        kind: "denied",
        name: match.person!.name,
        at: deniedAt,
        personId: match.person!.id,
        detail,
      });

      if (!isRepeatDenial) {
        await addLog({
          person_id: match.person!.id,
          person_name: match.person!.name,
          person_type: match.person!.uniform_type === "guest" ? "guest" : "student",
          direction: "entry",
          method: "face",
          success: false,
          confidence: match.confidence,
          uniform_ok: code === "WRONG_UNIFORM" || code === "NO_UNIFORM" ? false : null,
          failure_reason: detail,
          reason_code: code,
          decision_note: detail,
          client_id: "kiosk-01",
          device_timestamp: new Date().toISOString(),
        }).catch((err) => console.warn("[Kiosk] Log write failed:", err));
      }

      refreshStats();

      // Reset after a moment — token-guarded like the grant card.
      setTimeout(() => {
        if (decisionSeqRef.current !== cardToken) return;
        if (kioskStateRef.current === "denied") {
          setKioskState("ready");
          setStatusMessage("Ready");
          setLastMatch(null);
          setVerdict(null);
          // Same stuck-phase fix as the grant path.
          setScanStep("searching");
        }
      }, 4000);
    } else {
      // Safety net for unconfirmed ticks (a stranger still settling). It must
      // NEVER clobber a verdict hold: recognition
      // keeps running while a grant/deny card owns the screen, and a new face
      // stepping in behind the decided student used to yank their card away
      // mid-hold via this branch. Only touch idle states.
      if (kioskStateRef.current !== "granted" && kioskStateRef.current !== "denied") {
        setKioskState("ready");
        setStatusMessage("Scanning...");
      }
      // Deliberately no audit row here. access_logs records identified
      // students — granted, or denied by policy — and nothing else; an
      // unreadable face is not an access attempt by a known identity. This
      // branch must also never touch the re-arm lock: an unknown face is not
      // a decision, and locking here deadlocked the scanner (the person could
      // never be re-scored into a match).
    }
  }

  // ─── Drawing ────────────────────────────────────────────

  /**
   * The camera heads-up display.
   *
   * Shows what the AI sees, in order, so nobody has to guess whether the
   * terminal is working:
   *   1. framing  → ONE guide at a time: a big oval in the centre until the
   *                 face is identified, then the oval clears and a wide
   *                 rectangle over the uniform takes over (never both at once)
   *   2. face     → reticle around the detected face + detection confidence,
   *                 with a sweeping scan line while it works
   * Reads refs only (this runs inside the rAF loop) and is privacy-safe:
   * labels carry detector telemetry, never a name.
   */
  function drawOverlays(overlayCanvas: HTMLCanvasElement) {
    const ctx = overlayCanvas.getContext("2d");
    if (!ctx) return;

    const W = overlayCanvas.width;
    const H = overlayCanvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!W || !H) return;

    const now = Date.now();
    const state = kioskStateRef.current;
    const match = lastMatchRef.current;
    const verifying =
      state === "ready" || state === "scanning" || state === "granted" || state === "denied";

    // Hold the reticle briefly after a detection miss (blinks, head turns) so
    // the box does not strobe, then let it fade out — a hard cut looks broken.
    const faceAge = now - lastFaceAtRef.current;
    const faces = faceAge < FACE_RETICLE_HOLD_MS ? lastFacesRef.current : [];
    const reticleAge = faces.length > 0 ? Math.max(0, faceAge) : 0;
    const reticleAlpha = Math.max(0.25, 1 - reticleAge / FACE_RETICLE_HOLD_MS);

    const unit = W / 100; // scale everything off the frame width

    // ── 1. Where to stand — one guide at a time ──
    // The kiosk shows a single framing guide, in the order the checks run:
    //   • not identified yet → ONE big oval in the centre, face only.
    //   • face identified    → the oval has done its job and clears away, and
    //                          a wide rectangle over the uniform takes over.
    // Both guides at once fought for the same screen space — the FACE and
    // UNIFORM chips stacked on top of each other and the two dashed edges
    // crossed the student's face. Swapping them leaves exactly one
    // instruction on screen and says what the terminal is doing right now.
    //
    // Looks only: the acceptance rule is unchanged (face centre inside the
    // zone ellipse in slotZones), so gating, cooldowns and unit tests are
    // untouched — only the painted guides changed.
    if (verifying) {
      for (const zone of zonesRef.current) {
        const card = slotCardsRef.current[zone.id];
        const cx = zone.cx * W;
        const cy = zone.cy * H;
        const rx = zone.rx * W;
        const ry = zone.ry * H;
        const liveFace = lastFacesRef.current.find(
          (f) => slotOfFace(f.bbox, zonesRef.current) === zone.id,
        );
        const occupied = !!liveFace;
        const rgb = card ? "16, 185, 129" : occupied ? "96, 165, 250" : "255, 255, 255";
        const torsoScan = uniformScanRef.current;
        const reading = !!torsoScan && now < torsoScan.until;
        const labelSize = Math.max(11, unit * 1.5);

        // Identity in hand (a named card) or the uniform read running means the
        // face stage is over: drop the oval, show the uniform box. A raw
        // per-frame match is deliberately NOT enough — one lucky frame swapped
        // the guide to UNIFORM while the card still read UNKNOWN FACE. When the
        // identity is lost the card clears, so the oval comes straight back.
        const uniformPhase = !!card || reading;

        if (!uniformPhase) {
          // ── Oval: the standing spot, face only ──
          // Dim everything OUTSIDE the oval. A white dashed outline on its own
          // disappeared against a bright wall — the lobby is not a dark room —
          // so the standing spot is lit instead of merely outlined: the scrim
          // gives the interior contrast on any scene, and the edge sits on top.
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, W, H);
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(8, 15, 30, 0.32)";
          ctx.fill("evenodd");
          ctx.restore();

          // Tall oval, like a person: a head and shoulders are taller than they
          // are wide. Drawn twice — a dark halo so the light edge never melts
          // into a pale background, then the moving dashed edge at full
          // opacity.
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.lineWidth = Math.max(6, unit * 1.5);
          ctx.strokeStyle = "rgba(8, 15, 30, 0.45)";
          ctx.stroke();

          ctx.setLineDash([unit * 2.2, unit * 1.9]);
          ctx.lineDashOffset = -((now / 26) % 1000);
          ctx.lineWidth = Math.max(3, unit * 0.62);
          ctx.strokeStyle = `rgba(${rgb}, 1)`;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();

          // The pill is dark because drawChip() writes white text — a white
          // pill would be invisible on the idle (white) oval colour.
          drawChip(
            ctx,
            cx,
            Math.min(cy + ry * 0.74, H * 0.7),
            occupied ? "HOLD STILL" : "STAND HERE",
            occupied ? rgb : "30, 41, 59",
            "center",
            labelSize,
          );
        } else {
          // ── Uniform rectangle: lower middle, shoulder to waist ──
          // Anchored to the live face's chin when there is one, so the box
          // lands on the torso actually in frame; falls back to the zone
          // geometry so the guide still shows for a decision made a moment
          // ago (the face may already have stepped away).
          const chinY = liveFace ? (liveFace.bbox[1] + liveFace.bbox[3]) * H : cy + ry * 0.2;
          const faceW = liveFace ? liveFace.bbox[2] * W : zone.rx * W;
          const torsoW = Math.min(W * 0.72, Math.max(faceW * 2.6, zone.rx * W * 1.7));
          const torsoX = cx - torsoW / 2;
          const torsoY = Math.max(cy - ry * 0.1, Math.min(chinY - unit * 0.5, H * 0.62));
          const torsoH = Math.max(unit * 9, H * 0.95 - torsoY);
          const corner = unit * 1.6;

          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, W, H);
          roundRectPath(ctx, torsoX, torsoY, torsoW, torsoH, corner);
          ctx.fillStyle = card ? "rgba(8, 15, 30, 0.18)" : "rgba(8, 15, 30, 0.32)";
          ctx.fill("evenodd");
          ctx.restore();

          ctx.save();
          roundRectPath(ctx, torsoX, torsoY, torsoW, torsoH, corner);
          ctx.lineWidth = Math.max(6, unit * 1.5);
          ctx.strokeStyle = "rgba(8, 15, 30, 0.45)";
          ctx.stroke();

          ctx.setLineDash(card ? [] : [unit * 2.2, unit * 1.9]);
          ctx.lineDashOffset = -((now / 26) % 1000);
          ctx.lineWidth = Math.max(3, unit * 0.62);
          ctx.strokeStyle = `rgba(${rgb}, 1)`;
          roundRectPath(ctx, torsoX, torsoY, torsoW, torsoH, corner);
          ctx.stroke();
          ctx.restore();

          // What this box is for, then what to do about it. Guide names, never
          // an identity — same privacy rule as the face chips.
          drawChip(ctx, torsoX, torsoY - unit * 0.6, "UNIFORM", rgb, "left", labelSize);
          if (!card) {
            drawChip(
              ctx,
              cx,
              Math.min(torsoY + torsoH * 0.86, H * 0.74),
              reading ? "READING UNIFORM…" : occupied ? "HOLD STILL" : "STAND HERE",
              reading ? "245, 158, 11" : occupied ? rgb : "30, 41, 59",
              "center",
              labelSize,
            );
          }
        }
      }
    }

    // ── 2. Face reticle(s) ──
    for (const face of faces) {
      const [x, y, w, h] = face.bbox;
      const bx = x * W;
      const by = y * H;
      const bw = w * W;
      const bh = h * H;

      // Green brackets are earned, not guessed: only a CONFIRMED identity
      // (full hold-still count + runner-up margin) lights the frame green. A
      // raw per-tick winner stays blue until it confirms — a stranger
      // flickering between lookalikes must never see a green "you" signal.
      const faceSlot = slotOfFace(face.bbox, zonesRef.current);
      const slotCard = faceSlot === null ? null : slotCardsRef.current[faceSlot];
      const confirmedLive =
        !!slotCard && match?.matched === true && match.person?.id === slotCard.id;
      const rgb =
        state === "denied"
          ? "244, 63, 94"
          : state === "granted" || confirmedLive
            ? "16, 185, 129"
            : "96, 165, 250";

      // Corners only — no drawn rectangle around the face. The brackets and the
      // moving sweep already say "this is what I am tracking", and leaving the
      // middle empty keeps the student's own face completely unobscured.
      drawBrackets(
        ctx,
        bx,
        by,
        bw,
        bh,
        rgb,
        reticleAlpha,
        Math.max(4, unit * 0.75),
        Math.min(bw, bh) * 0.26,
      );

      // Detector confidence is telemetry, not identity — safe on a public screen.
      drawChip(
        ctx,
        bx,
        by - unit * 1.5,
        `FACE ${Math.round(face.confidence * 100)}%`,
        rgb,
        "left",
        Math.max(12, unit * 1.8),
      );

      // Sweeping scan line so it is obvious the terminal is actively reading.
      // Soft-edged and translucent: a passing glint, never a bar over the face.
      if (verifying && !match?.matched) {
        const sweepY = by + bh * ((now % 1900) / 1900);
        const grad = ctx.createLinearGradient(bx, sweepY, bx + bw, sweepY);
        grad.addColorStop(0, `rgba(${rgb}, 0)`);
        grad.addColorStop(0.5, `rgba(${rgb}, 0.6)`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(1.5, unit * 0.28);
        ctx.beginPath();
        ctx.moveTo(bx, sweepY);
        ctx.lineTo(bx + bw, sweepY);
        ctx.stroke();
      }
    }

    // ── 3. Uniform read band ──
    // While YOLO is reading the torso, bracket the exact band being judged in
    // amber, so the student can see the check is live and whether the uniform
    // is actually inside the read area. The "READING UNIFORM…" wording lives on
    // the uniform box's own pill (step 1) — two chips on one band collided.
    const uscan = uniformScanRef.current;
    if (verifying && uscan && now < uscan.until) {
      const [ux, uy, uw, uh] = uscan.bbox;
      drawBrackets(
        ctx,
        ux * W,
        uy * H,
        uw * W,
        uh * H,
        "245, 158, 11",
        0.95,
        Math.max(3, unit * 0.55),
        Math.min(uw * W, uh * H) * 0.18,
      );
    }
  }

  // ─── Gate Handler ──────────────────────────────────────

  function handleGateEvent(event: GateEvent) {
    if (event.type === "button_press") {
      // Guard pressed the physical override button — token its card like a
      // scan decision so a face scan landing during the hold isn't clobbered.
      const overrideToken = ++decisionSeqRef.current;
      openGate().catch(() => {});
      setKioskState("granted");
      playCue("override");
      setStatusMessage("Manual override — gate opened");

      // Confirm gate feedback (best effort)
      confirmGateOpen(2000)
        .then((opened) => {
          setGateState(opened ? "OPEN" : null);
          return addLog({
            person_id: null,
            person_name: "Manual Override",
            person_type: "manual",
            direction: "entry",
            method: "manual",
            success: true,
            confidence: null,
            failure_reason: null,
            gate_state: opened ? "open" : "unconfirmed",
            device_timestamp: new Date().toISOString(),
          });
        })
        .catch(() => {});

      setTimeout(() => {
        if (decisionSeqRef.current !== overrideToken) return;
        setKioskState("ready");
        setStatusMessage("Ready");
        setGateState(null);
        closeGate().catch(() => {});
      }, 5000);
    } else if (event.type === "connected") {
      setGateConnected(true);
      setGateTransport(event.transport ?? null);
    } else if (event.type === "disconnected") {
      setGateConnected(false);
      setGateState(null);
      // Informational: reconnect happens automatically with backoff
      console.log("[Kiosk] Gate disconnected, auto-reconnect will attempt...");
    } else if (event.type === "reconnecting") {
      setStatusMessage("Reconnecting to gate...");
    } else if (event.type === "reconnect_failed") {
      setStatusMessage("Gate disconnected — tap to reconnect");
    } else if (event.type === "gate_state") {
      setGateState(event.data ?? null);
    }
  }

  // ─── Sync ───────────────────────────────────────────────

  async function syncInBackground() {
    try {
      const status = await fullSync();
      if (!status.error) {
        lastSyncRef.current = status.lastSync;
        // Refresh even when zero students were downloaded: a successful sync
        // may have deactivated every student and cleared local profiles.
        await refreshEnrolledFaces();
      }
      // Reload settings after sync (they may have changed)
      await loadSettingsFromDb();
      setSyncStatus(
        status.studentsDownloaded > 0 || status.logsUploaded > 0
          ? `Synced: ${status.studentsDownloaded} students, ${status.logsUploaded} logs`
          : "",
      );
    } catch (err) {
      console.warn("[Kiosk] Background sync failed:", err);
    }
    refreshStats();
  }

  /**
   * Load a student photo from URL into a canvas for processing.
   */
  async function loadPhotoCanvas(photoUrl: string): Promise<HTMLCanvasElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || 640;
        canvas.height = img.naturalHeight || 480;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => resolve(null);
      img.src = photoUrl;
      setTimeout(() => resolve(null), 10000);
    });
  }

  /**
   * 🔴 ACCURACY FIX #4: Parse photo_url which may be a JSON array of multiple photo URLs.
   * Returns an array of photo URLs to process.
   */
  function parsePhotoUrls(photoUrl: string | null): string[] {
    if (!photoUrl) return [];
    try {
      // Try to parse as JSON array first
      if (photoUrl.startsWith("[")) {
        const parsed = JSON.parse(photoUrl);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      }
    } catch {
      // Not a JSON array, treat as single URL
    }
    // Single URL
    return [photoUrl];
  }

  async function handleManualSync() {
    setSyncStatus("Syncing...");
    const status = await fullSync();
    if (!status.error) {
      lastSyncRef.current = status.lastSync;
      // Also refresh on a successful zero-student sync so deactivations take
      // effect immediately in the in-memory matcher.
      await refreshEnrolledFaces();
    }
    setSyncStatus(
      status.error
        ? `Sync error: ${status.error}`
        : `Synced: ${status.studentsDownloaded} students, ${status.logsUploaded} logs`,
    );
    refreshStats();
    if (showQueueModal) void loadQueue();
  }

  /** Read every access row still waiting in IndexedDB for upload. */
  async function loadQueue() {
    setQueueLoading(true);
    try {
      setQueueLogs(await getUnsyncedLogs());
    } catch {
      setQueueLogs([]);
    }
    setQueueLoading(false);
    refreshStats();
  }

  function openQueueModal() {
    setShowQueueModal(true);
    void loadQueue();
  }

  /** Push the whole offline queue to the cloud, then refresh the list. */
  async function syncQueueNow() {
    if (queueSyncing || !online) return;
    setQueueSyncing(true);
    await handleManualSync();
    await loadQueue();
    setQueueSyncing(false);
  }

  async function refreshEnrolledFaces() {
    // Process student photos to generate embeddings
    // 🔴 FIX BUG #2: Skip if already processing (mutex guard)
    if (photoProcessingRef.current) {
      console.log("[Kiosk] Photo processing already in progress, skipping...");
      // Still refresh face list from whatever is already stored
      const faces = await getEnrolledFaces();
      enrolledRef.current = faces;
      setEnrolledCount(faces.length);
      await updateEnrollmentHealth();
      return;
    }
    await processStudentPhotos();
    const faces = await getEnrolledFaces();
    enrolledRef.current = faces;
    setEnrolledCount(faces.length);
    await updateEnrollmentHealth();
  }

  /**
   * How many synced profiles actually carry a usable face template.
   * getEnrolledFaces() silently drops profiles with zero embeddings, so the
   * in-memory matcher can be empty while the roster looks full — measure
   * against the stored rows instead.
   */
  async function updateEnrollmentHealth() {
    const all = await getAllStudents();
    const active = all.filter((s) => s.is_active);
    // Refresh the QR roster here because every path that reloads enrolled faces
    // runs this too. Profiles without a face template are INCLUDED: choosing the
    // ID instead of the camera must not depend on having a usable template.
    qrRosterRef.current = active
      .filter((s) => normalizeStudentId(s.student_id) !== "")
      .map((s) => ({
        id: s.id,
        name: s.name,
        student_id: s.student_id,
        department: s.department,
        uniform_type: s.uniform_type,
        embeddings: [],
        host_name: s.host_name ?? null,
        purpose: s.purpose ?? null,
        valid_until: s.valid_until ?? null,
      }));
    const missing = active.filter((s) => s.embeddings.length === 0).map((s) => s.name);
    setEnrollmentHealth({
      total: active.length,
      withFace: active.length - missing.length,
      missing,
    });
  }

  /**
   * Process downloaded student photos to generate face embeddings.
   * Uses a mutex (photoProcessingRef) to prevent concurrent execution
   * when sync triggers while already processing.
   */
  async function processStudentPhotos() {
    // 🔴 FIX BUG #2: Mutex guard — prevent concurrent photo processing
    if (photoProcessingRef.current) {
      console.log("[Kiosk] Photo processing already in progress, skipping...");
      return;
    }

    photoProcessingRef.current = true;

    try {
      const students = await getActiveStudents();
      if (students.length === 0) return;

      // 🔴 ACCURACY FIX #4: Check if embeddings need to be generated
      // A student needs processing if they have no embeddings and have photos
      const needsProcessing = students.filter((s) => s.embeddings.length === 0 && s.photo_url);
      if (needsProcessing.length === 0) return;

      setStatusMessage(`Processing ${needsProcessing.length} student photos...`);

      // Process a single student photo
      async function processOne(student: StoredStudent): Promise<boolean> {
        if (!student.photo_url) return false;

        try {
          // 🔴 ACCURACY FIX #4: Get ALL photo URLs for this student
          const photoUrls = parsePhotoUrls(student.photo_url);
          if (photoUrls.length === 0) return false;

          const embeddings: Float32Array[] = [];

          for (const url of photoUrls) {
            const photoCanvas = await loadPhotoCanvas(url);
            if (!photoCanvas) continue;

            const faces = detectFacesFromCanvas(photoCanvas);
            const pick = selectEnrollmentFace(faces ?? [], photoCanvas.width);
            if (!pick.ok) {
              // Never embed "whatever face was biggest": a group photo used to
              // file a classmate's face under this student's name.
              console.warn(
                `[Kiosk] Skipped a photo for ${student.name}: ${pick.reason}.`,
              );
              continue;
            }

            const embedding = await getFaceEmbeddingFromCanvas(photoCanvas, pick.face.bbox);
            if (embedding && embedding.length > 0) {
              embeddings.push(embedding);
            }
          }

          if (embeddings.length === 0) return false;

          const existing = await getStudent(student.id);
          if (existing) {
            existing.embeddings = embeddings;
            await storeStudents([existing]);
          }
          return true;
        } catch (err) {
          console.warn(`Failed to process photo for ${student.name}:`, err);
          return false;
        }
      }

      // Process in batches of 3 concurrently (fewer per batch since each may have multiple photos)
      const CONCURRENT = 3;
      let processedCount = 0;

      for (let i = 0; i < needsProcessing.length; i += CONCURRENT) {
        const batch = needsProcessing.slice(i, i + CONCURRENT);
        const results = await Promise.all(batch.map(processOne));
        processedCount += results.filter(Boolean).length;
      }

      if (processedCount > 0) {
        console.log(`Processed ${processedCount} student photos`);
      }
    } finally {
      photoProcessingRef.current = false;
    }
  }

  async function refreshStats() {
    const stats = await getDatabaseStats();
    setDbStats(stats);
  }

  // ─── Cleanup ────────────────────────────────────────────

  function cleanup() {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    stopHeartbeat();
    disconnectGate().catch(() => {});
    cleanupFaceResources();
  }

  // ─── Network Status ─────────────────────────────────────

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => {
      setOnline(true);
      // 🔴 FIX CRITIQUE #2: Use ref to avoid stale closure on syncInBackground
      if (kioskStateRef.current === "ready") {
        syncInBackground();
      }
    };
    const handleOffline = () => {
      setOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once — syncInBackground and kioskState read via refs

  /**
   * Load settings from IndexedDB and update settingsRef.
   * Called after sync and during init.
   */
  async function loadSettingsFromDb() {
    try {
      const settings = await getAllSettings();
      const threshold = settings.find((s) => s.key === "face_recognition_threshold");

      const lockdownRow = settings.find((s) => s.key === "lockdown_mode");
      const lockdownWhy = settings.find((s) => s.key === "lockdown_reason");
      const locked = (lockdownRow?.value ?? "false") === "true";
      settingsRef.current.lockdownMode = locked;
      settingsRef.current.lockdownReason = lockdownWhy?.value ?? "";
      setLockdownActive(locked);
      setLockdownReason(lockdownWhy?.value ?? "");
      if (threshold) {
        const parsed = parseFloat(threshold.value);
        if (!isNaN(parsed)) {
          // A low value here is how the gate started naming the wrong student:
          // 0.6 was saved from the dashboard and used verbatim.
          const safe = Math.max(MIN_MATCH_THRESHOLD, parsed);
          if (safe !== parsed) {
            console.warn(
              `[Kiosk] face_recognition_threshold ${parsed} is below the ${MIN_MATCH_THRESHOLD} floor — using ${MIN_MATCH_THRESHOLD}. Raise it in Dashboard → Settings.`,
            );
          }
          settingsRef.current.matchThreshold = safe;
        }
      }

      const qrSetting = settings.find((s) => s.key === "allow_qr_entry");
      const qrAllowed = (qrSetting?.value ?? "true") !== "false";
      settingsRef.current.allowQr = qrAllowed;
      setAllowQr(qrAllowed);

      // 019 uniform: the dashboard toggle; defaults ON so a kiosk that has
      // never synced still enforces the dress check once the model loads.
      const uniformSetting = settings.find((s) => s.key === "uniform_detection_enabled");
      const enforced = (uniformSetting?.value ?? "true") !== "false";
      settingsRef.current.uniformEnabled = enforced;
      setUniformEnforced(enforced);

      // Gate open window — the dashboard has always written this row, but the
      // kiosk never read it and hardcoded 5s instead.
      const gateDuration = settings.find((s) => s.key === "gate_open_duration");
      if (gateDuration) {
        const parsed = parseFloat(gateDuration.value);
        if (!isNaN(parsed) && parsed > 0) {
          settingsRef.current.gateOpenDuration = parsed;
        }
      }

      // Branding + voice school from synced settings
      const rawName = settings.find((s) => s.key === "school_name")?.value ?? "";
      const initials = settings.find((s) => s.key === "school_initials")?.value ?? "";
      if (rawName && rawName !== "Smart Academy") {
        setSchoolBrand((prev) => ({ ...prev, name: rawName }));
      }
      if (initials) {
        setSchoolBrand((prev) => ({ ...prev, initials }));
        setVoiceSchool(initials);
      }

      settingsLoadedRef.current = true;
      console.log("[Kiosk] Settings loaded:", settingsRef.current);
    } catch (err) {
      console.warn("[Kiosk] Failed to load settings:", err);
    }
  }

  // ─── Hardware Self-Test (no camera required) ────────────

  /** Poll a predicate until it holds or the deadline passes. */
  function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        if (predicate()) return resolve(true);
        if (Date.now() - startedAt > timeoutMs) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  /** Make sure a controller is linked, retrying once if it is not. */
  async function ensureGateLinked(): Promise<boolean> {
    if (gateConnectedRef.current) return true;
    const conn = await connectToGate().catch(() => ({ connected: false, transport: null }));
    setGateConnected(conn.connected);
    setGateTransport(conn.transport);
    return conn.connected;
  }

  /**
   * Bench test for the servo + ESP32. Issues real open/close commands and
   * watches the controller's own state broadcasts, so a pass means the whole
   * chain worked: browser → Wi-Fi → ESP32 → servo → state back.
   */
  async function runServoSelfTest() {
    if (hwTest.running) return;
    const stamp = performance.now();

    try {
      setHwTest({ running: true, ok: null, result: "Linking to the gate..." });
      if (!(await ensureGateLinked())) {
        throw new Error(
          "no controller linked — join the SmartGate-Gate1 hotspot (or plug in USB) and retry",
        );
      }

      setHwTest({ running: true, ok: null, result: "Opening gate..." });
      await openGate();
      const opened = await waitFor(
        () => gateStateRef.current === "OPEN" || gateStateRef.current === "OPENING",
        4000,
      );
      if (!opened) throw new Error("no OPEN state came back — check the servo signal wire");

      setHwTest({ running: true, ok: null, result: "Closing gate..." });
      await closeGate();
      const closed = await waitFor(() => gateStateRef.current === "IDLE", 6000);
      if (!closed) throw new Error("gate never returned to IDLE");

      const ms = Math.round(performance.now() - stamp);
      setHwTest({ running: false, ok: true, result: `PASS — full open/close cycle in ${ms} ms` });
    } catch (err) {
      setHwTest({
        running: false,
        ok: false,
        result: `FAIL — ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  }

  /** Single open/close command, for checking one direction at a time. */
  async function handleTestPulse(action: "open" | "close") {
    try {
      if (!(await ensureGateLinked())) {
        setHwTest({
          running: false,
          ok: false,
          result: "FAIL — no controller linked (hotspot or USB cable)",
        });
        return;
      }
      if (action === "open") {
        await openGate();
        setHwTest({ running: false, ok: true, result: "Open command sent — watch the arm" });
      } else {
        await closeGate();
        setHwTest({ running: false, ok: true, result: "Close command sent — watch the arm" });
      }
    } catch (err) {
      setHwTest({
        running: false,
        ok: false,
        result: `FAIL — ${err instanceof Error ? err.message : "command rejected"}`,
      });
    }
  }

  // ─── Connect Gate Button ───────────────────────────────

  async function handleConnectGate() {
    try {
      const conn = await connectToGate();
      setGateConnected(conn.connected);
      setGateTransport(conn.transport);
    } catch (err) {
      console.error("Gate connection failed:", err);
    }
  }

  /**
   * Toggle voice announcements (persisted to IndexedDB).
   */
  async function handleToggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceEnabled(next);
    try {
      await storeSetting("voice_enabled", next ? "true" : "false");
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Play the grant cue so the operator can hear the speaker.
   * Tapping "test" implies wanting sound, so it also turns voice back on.
   */
  async function handleTestVoice() {
    if (!voiceOn) {
      setVoiceOn(true);
      setVoiceEnabled(true);
      try {
        await storeSetting("voice_enabled", "true");
      } catch {
        /* non-fatal */
      }
    }
    unlockAudio();
    primeSpeechVoices();
    playCue("grant");
  }

  async function sendHeartbeatTick(): Promise<HeartbeatInput> {
    const stats = await getDatabaseStats().catch(() => null);
    const payload: HeartbeatInput = {
      kioskName: "Gate 1",
      cameraOk: streamRef.current?.active ?? false,
      gateConnected: gateConnectedRef.current,
      gateState: gateStateRef.current,
      studentsCount: stats?.studentCount ?? 0,
      unsyncedLogs: stats?.unsyncedCount ?? 0,
      lastSync: lastSyncRef.current,
      fps: Math.round(fpsRef.current || 0),
      lastError: kioskStateRef.current === "error" ? statusMessage : null,
    };
    // Fire-and-forget — the payload is returned so the loop stays simple.
    void sendHeartbeat(payload).catch((err) => {
      // Migration 007 not run yet — the heartbeat loop already paused
      // itself, so don't repeat the error here.
      if (isHeartbeatTableMissing(err)) return;
      console.warn("[Kiosk] Heartbeat failed:", err);
    });
    return payload;
  }

  // ─── Render ─────────────────────────────────────────────

  /**
   * Live scan pipeline shown to whoever is standing at the terminal:
   * Face → Identity → Uniform, each step reporting idle / working / ok / fail.
   * This is the "is it actually doing something?" answer — the detection loop
   * publishes scanStep, and the recognition + uniform results fill it in.
   */
  const pipeline = (() => {
    const verifying = kioskState === "ready" || kioskState === "scanning";
    if (!verifying) return null;

    // ─── Already decided ──────────────────────────────────
    // A grant or a denial locks the scanner until the gate area clears, so
    // there is nothing to report as "working". Say what actually happened and
    // what to do next, instead of spinning a step that will not resolve.
    if (holdNotice) {
      // Inside the cooldown the decision still stands; past it the person would
      // need a fresh scan, which needs them to leave the frame anyway.
      const stillCounts = Date.now() - holdNotice.at < NOTICE_WINDOW_MS;
      const at = new Date(holdNotice.at).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });

      // Within the cooldown the decision still stands for THAT student; the
      // notice clears by itself once they (or a different visitor) move on.
      if (holdNotice.kind === "granted" && stillCounts) {
        return {
          face: "ok" as StepVisual,
          identity: "ok" as StepVisual,
          title: "You are already recorded — proceed to the gate",
          hint: `${holdNotice.name} passed at ${at}. Verified once — there is no need to scan again.`,
        };
      }

      if (holdNotice.kind === "denied" && stillCounts) {
        return {
          face: "ok" as StepVisual,
          identity: "ok" as StepVisual,
          title: "Access denied — step away, then try again",
          hint:
            holdNotice.detail ??
            "Step out of the oval and back in to re-scan.",
        };
      }

      // Past the 60s window with the same student STILL standing there: the
      // scanner is holding their already-made decision, so say what gets them
      // a fresh one (a real step-out re-arms their identity).
      return {
        face: "ok" as StepVisual,
        identity: "ok" as StepVisual,
        title: "You are already recorded — step aside to re-scan",
        hint: `${holdNotice.name} passed at ${at}. Step out of the oval briefly, then step back in to verify again.`,
      };
    }

    // The rail may only ever name a CONFIRMED identity: the raw per-tick
    // winner flickers between lookalikes, so an unconfirmed "match" reads as
    // still-verifying — never a name, never a score.
    const livePersonId =
      lastMatch?.matched && lastMatch.person ? lastMatch.person.id : null;
    const confirmedLive = confirmed && livePersonId === confirmed.id ? confirmed : null;
    const matched = confirmedLive !== null;
    const verifyHint =
      confirmProgress > 0
        ? `Verifying identity — hold still ${Math.max(1, Math.ceil((FACE_MATCH_WINDOW_MS - confirmProgress) / 1000))}s`
        : "Verifying identity — look at the camera and hold still";

    let face: StepVisual = "working";
    let identity: StepVisual = "idle";
    let title = "Step in front of the camera";
    let hint = "Face detection is live — the oval shows where to stand";

    if (scanStep === "searching") {
      face = "working";
    } else if (scanStep === "face") {
      face = "ok";
      identity = "working";
      title = "Face detected — hold still";
      hint = verifyHint;
    } else if (scanStep === "verify") {
      face = "ok";
      identity = matched ? "ok" : "working";
      if (matched) {
        // Name goes up the moment identity is confirmed — the ~5s hold-still
        // belongs to the face step for an accurate name.
        title = confirmedLive!.name;
        hint = "Identity verified — checking guest pass";
      } else {
        // A raw winner the gate hasn't confirmed yet: still verifying, and
        // the identity chip must NOT flip to fail on a settling read.
        title = "Verifying identity — hold still";
        hint = verifyHint;
      }
    } else if (scanStep === "done") {
      face = "ok";
      identity = matched ? "ok" : "fail";
      title = "Verification complete";
      hint = statusMessage;
    }

    if (!matched && lastMatch && scanStep === "done") {
      // Only once the read has settled — mid-scan frames score far below the
      // person's real similarity and the number would look alarming.
      // Surface the real similarity score — it is the difference between
      // "the terminal is broken" and "nobody is enrolled yet", and it is the
      // number you tune with Face Match Threshold.
      const scorePct = Math.max(0, Math.round((lastMatch.confidence ?? 0) * 100));
      const needPct = Math.round(settingsRef.current.matchThreshold * 100);
      hint =
        lastMatch.confidence > 0
          ? `Closest enrolled profile ${scorePct}% — ${needPct}% is required to open the gate`
          : "Face detected, but it doesn't match any enrolled student";
    } else if (confirmedLive && scanStep !== "verify") {
      hint = `Identity verified at ${Math.round(confirmedLive.confidence * 100)}%`;
    }

    return { face, identity, title, hint };
  })();

  return (
    <div className="fixed inset-0 w-full h-full bg-black overflow-hidden select-none">
      {/* ─── Tap-to-Start Splash (unlocks camera + audio) ── */}
      {showSplash && (
        <div
          onClick={handleStart}
          role="button"
          tabIndex={0}
          aria-label="Tap screen to start"
          className="splash-fit absolute inset-0 z-50 bg-[#f8fafc] flex flex-col justify-between gap-3 p-3.5 sm:p-10 lg:p-14 overflow-y-auto select-none cursor-pointer"
        >
          {/* Decorative layers are clipped to the screen: an orb hanging off the
              bottom edge otherwise extends the scroll box and lets the kiosk
              drift when someone touches the glass. */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
            {/* Ambient luminous glow orbs (light theme) */}
            <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl" />
            <div className="absolute -bottom-32 -right-32 w-[30rem] h-[30rem] bg-indigo-400/10 rounded-full blur-3xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-sky-300/5 rounded-full blur-[100px]" />

            {/* Micro dot grid texture */}
            <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:28px_28px] opacity-40" />
          </div>

          {/* Institutional Top Header (Edge-to-Edge Full Width) */}
          <div className="relative z-10 flex items-center justify-between gap-2 w-full max-w-5xl mx-auto pb-2.5 sm:pb-6 border-b border-slate-200/80 pointer-events-none">
            <div className="flex items-center gap-3.5 sm:gap-4">
              <img src="/isufst-logo.png" alt="ISUFST logo" className="splash-logo rounded-2xl object-contain p-0.5 shadow-lg shadow-blue-600/25 shrink-0 bg-white" />
              <div className="leading-snug">
                <p className="text-[10px] leading-[1.15] sm:text-base md:text-lg font-black tracking-tight text-slate-900 uppercase">
                  {schoolBrand.name}
                </p>
                <p className="text-[9px] leading-tight sm:text-sm font-semibold text-blue-600 tracking-wider uppercase">
                  Smart Gate Automated Terminal • Gate 01 • Main Entrance
                </p>
              </div>
            </div>

            {/* Live Clock & Node status badge */}
            <div className="flex items-center gap-2.5 sm:gap-3">
              {currentTime && (
                <div className="hidden sm:flex items-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-2xl bg-white border border-slate-200/90 shadow-sm text-sm sm:text-base font-mono font-bold text-slate-800">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <span>{currentTime}</span>
                </div>
              )}
              <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 sm:gap-2.5 sm:px-5 sm:py-2.5 rounded-2xl bg-emerald-50 border border-emerald-200/90 shadow-sm text-[11px] sm:text-base font-bold text-emerald-700">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Ready</span>
              </div>
            </div>
          </div>

          {/* Full-Screen Center Stage — Standing Eye Level Display */}
          <div className="splash-stage relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-4xl mx-auto text-center pointer-events-auto">
            {/* Massive Biometric Scanning Emblem */}
            <div className="splash-emblem relative mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 animate-ping opacity-40" />
              <div className="absolute -inset-3 sm:-inset-4 rounded-full border-2 border-dashed border-blue-400/40 animate-[spin_25s_linear_infinite]" />
              <div className="absolute -inset-7 sm:-inset-8 rounded-full border border-blue-300/20" />
              <div className="splash-emblem-core rounded-3xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-2xl shadow-blue-600/35">
                <Scan className="w-14 h-14 sm:w-18 sm:h-18 md:w-22 md:h-22 stroke-[1.75]" />
              </div>
            </div>

            {/* Title & Headline */}
            <div className="space-y-2.5 max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs sm:text-sm font-extrabold tracking-widest uppercase shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" /> AI Biometric & Policy
                Verification
              </div>
              <h1 className="splash-title font-black text-slate-900 tracking-tight leading-none">
                Smart Gate Terminal
              </h1>
              <p className="splash-subtitle text-slate-600 font-medium">
                Tap anywhere on the screen to begin verification
              </p>
            </div>

            {/* 3 Prominent Feature Cards */}
            <div className="grid grid-cols-3 gap-1.5 sm:gap-6 w-full max-w-3xl">
              <div className="splash-card rounded-2xl bg-white/90 backdrop-blur-xl border border-slate-200/90 shadow-sm flex flex-col items-center text-center">
                <div className="splash-card-icon mb-1.5 flex items-center justify-center rounded-lg border border-blue-100 bg-blue-50 sm:mb-3 sm:rounded-xl">
                  <UserCheck className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600" />
                </div>
                <span className="text-[10px] leading-tight sm:text-base font-black text-slate-900">
                  Face Biometrics
                </span>
                <span className="hidden sm:block text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                  Sub-second 3D match
                </span>
              </div>
              <div className="splash-card rounded-2xl bg-white/90 backdrop-blur-xl border border-slate-200/90 shadow-sm flex flex-col items-center text-center">
                <div className="splash-card-icon mb-1.5 flex items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 sm:mb-3 sm:rounded-xl">
                  <Ticket className="w-6 h-6 sm:w-7 sm:h-7 text-indigo-600" />
                </div>
                <span className="text-[10px] leading-tight sm:text-base font-black text-slate-900">
                  Guest Pass & Policy
                </span>
                <span className="hidden sm:block text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                  Pass expiry + lockdown
                </span>
              </div>
              <div className="splash-card rounded-2xl bg-white/90 backdrop-blur-xl border border-slate-200/90 shadow-sm flex flex-col items-center text-center">
                <div className="splash-card-icon mb-1.5 flex items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 sm:mb-3 sm:rounded-xl">
                  <ShieldCheck className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-600" />
                </div>
                <span className="text-[10px] leading-tight sm:text-base font-black text-slate-900">
                  Auto Turnstile
                </span>
                <span className="hidden sm:block text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                  Instant gate clearance
                </span>
              </div>
            </div>

            {/* Massive Touch-to-Start Button */}
            <div className="w-full max-w-2xl mx-auto pt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStart();
                }}
                className="splash-cta relative group w-full px-8 rounded-3xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:via-indigo-500 hover:to-blue-600 active:scale-[0.98] text-white font-black shadow-[0_20px_50px_rgba(37,99,235,0.4)] transition-all flex items-center justify-center gap-4 cursor-pointer overflow-hidden border-2 border-white/20"
              >
                <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 pointer-events-none" />
                <ShieldCheck className="w-7 h-7 sm:w-9 sm:h-9 text-white shrink-0" />
                <span className="tracking-wide">TAP ANYWHERE TO START</span>
                <ArrowRight className="w-6 h-6 sm:w-8 sm:h-8 text-white/80 group-hover:translate-x-1 transition-transform shrink-0" />
              </button>

              <div className="flex items-center justify-center gap-2 mt-4 text-xs sm:text-sm text-slate-500 font-medium">
                <Lock className="w-4 h-4 text-slate-400" />
                <span>Tap anywhere on the screen to begin verification</span>
              </div>
            </div>
          </div>

          {/* Institutional Footer (Full Width) */}
          <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-2 w-full max-w-5xl mx-auto pt-4 sm:pt-6 border-t border-slate-200/80 text-xs sm:text-sm font-semibold text-slate-500">
            <span>Authorized University Personnel & Enrolled Students Only</span>
            <span>
              {schoolBrand.initials} Automated Access System • Offline First Edge Architecture
            </span>
          </div>
        </div>
      )}

      {/* Hidden canvases for processing */}
      <canvas ref={canvasRef} className="hidden" />
      {/* HUD canvas — sized in JS to the video's painted box (see
          syncOverlayToVideo) so overlays sit exactly on what the camera sees. */}
      <canvas
        ref={overlayCanvasRef}
        className="fixed pointer-events-none z-10"
        style={{ left: 0, top: 0 }}
      />

      {/* Camera Feed - Full screen, raw, zero gradients */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Fullscreen Kiosk Scan Frame Corners */}
      {kioskState !== "init" && kioskState !== "loading_models" && (
        <div className="scan-frame z-10">
          <div
            className={`scan-corner scan-corner-tl ${kioskState === "granted" ? "!border-emerald-500 !drop-shadow-[0_0_12px_rgba(16,185,129,0.8)]" : kioskState === "denied" ? "!border-rose-500 !drop-shadow-[0_0_12px_rgba(244,63,94,0.8)]" : "border-white/80"}`}
          />
          <div
            className={`scan-corner scan-corner-tr ${kioskState === "granted" ? "!border-emerald-500 !drop-shadow-[0_0_12px_rgba(16,185,129,0.8)]" : kioskState === "denied" ? "!border-rose-500 !drop-shadow-[0_0_12px_rgba(244,63,94,0.8)]" : "border-white/80"}`}
          />
          <div
            className={`scan-corner scan-corner-bl ${kioskState === "granted" ? "!border-emerald-500 !drop-shadow-[0_0_12px_rgba(16,185,129,0.8)]" : kioskState === "denied" ? "!border-rose-500 !drop-shadow-[0_0_12px_rgba(244,63,94,0.8)]" : "border-white/80"}`}
          />
          <div
            className={`scan-corner scan-corner-br ${kioskState === "granted" ? "!border-emerald-500 !drop-shadow-[0_0_12px_rgba(16,185,129,0.8)]" : kioskState === "denied" ? "!border-rose-500 !drop-shadow-[0_0_12px_rgba(244,63,94,0.8)]" : "border-white/80"}`}
          />
        </div>
      )}

      {/* ─── Top Bar ─────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 sm:px-10 py-5 sm:py-7 z-30 pointer-events-none" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Floating school mark — no backdrop, no badge: the logo sits alone
              over the full camera view with the live status dot riding its
              corner, so chrome never boxes in the student's face. */}
          <div className="relative pointer-events-auto" title="ISUFST Smart Gate terminal">
            <img src="/isufst-logo.png" alt="ISUFST logo" className="w-14 h-14 sm:w-16 sm:h-16 object-contain drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]" />
            <span
              className={`absolute bottom-1 right-1 inline-flex w-3 h-3 rounded-full ring-2 ring-white ${
                kioskState === "error"
                  ? "bg-rose-500"
                  : kioskState === "ready" || kioskState === "granted"
                    ? "bg-emerald-500"
                    : "bg-blue-500"
              }`}
              aria-hidden
            />
          </div>
        </div>

        {/* Compact right cluster — time, link health, settings. Everything lives
            in the corners so no chrome can ever sit over the face or uniform. */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {currentTime && (
            <div className="hidden sm:flex glass-pill px-3.5 py-2.5 items-center gap-2 shadow-sm bg-white/90 border-white/40">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-mono text-xs sm:text-sm font-bold text-surface-700 tracking-wider">
                {currentTime}
              </span>
            </div>
          )}

          <div
            className="glass-pill px-3 py-2.5 flex items-center gap-1.5 shadow-sm bg-white/90 border-white/40"
            title={
              online
                ? gateConnected
                  ? "Online · gate linked"
                  : "Online"
                : "Offline — logs queue locally and sync on reconnect"
            }
          >
            {online ? (
              <Wifi className="w-4 h-4 text-emerald-600" />
            ) : (
              <WifiOff className="w-4 h-4 text-rose-500" />
            )}
            {gateConnected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
          </div>

          {/* Policy indicator (015/019): uniform vision is live again and enforced
              when the dashboard toggle is on — show what is actually running,
              not a hardcoded "retired". Offline queue count rides the wifi pill
              tooltip + admin panel. */}
          <div
            className={`flex glass-pill px-2.5 sm:px-3 py-2.5 items-center gap-1.5 shadow-sm border-white/40 ${lockdownActive ? "bg-rose-50/95 border-rose-200" : "bg-white/90"}`}
            title={
              lockdownActive
                ? `LOCKDOWN ACTIVE${lockdownReason ? ` — ${lockdownReason}` : ""} — all entries denied, guard override only`
                : "Policy mode — face + guest pass / lockdown active."
            }
          >
            <ShieldCheck className={`w-4 h-4 ${lockdownActive ? "text-rose-600" : "text-emerald-600"}`} />
            <span className={`text-[10px] font-black tracking-widest ${lockdownActive ? "text-rose-700" : "text-emerald-700"}`}>
              {lockdownActive ? "LOCKDOWN" : "POLICY ON"}
            </span>
            {!online && dbStats.unsyncedCount > 0 && (
              <span className="ml-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5">
                {dbStats.unsyncedCount} QUEUED
              </span>
            )}
          </div>

          <button
            onClick={() => setShowAdminPanel(!showAdminPanel)}
            className="glass-pill p-3 bg-white/90 border-white/40 hover:bg-white active:bg-surface-100 transition-all cursor-pointer text-surface-500 hover:text-surface-900 shadow-sm"
            aria-label="Open admin panel"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {cameraDown && (
        <div className="absolute left-4 sm:left-10 z-40 glass-pill pl-3 pr-4 py-2.5 flex items-center gap-2 bg-amber-50/95 border-amber-200 shadow-sm" style={{ top: "max(5.5rem, calc(env(safe-area-inset-top) + 4.5rem))" }}>
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-[11px] sm:text-xs font-bold text-amber-800 uppercase tracking-wider">
            Camera offline — hardware test mode
          </span>
        </div>
      )}

      {/* ─── Full-Screen Initialization / Boot Sequence ───────────────────────────── */}
      {kioskState === "loading_models" && (
        <div className="absolute inset-0 z-50 bg-[#f8fafc] flex flex-col justify-between p-6 sm:p-10 lg:p-14 select-none overflow-y-auto">
          {/* Ambient luminous glow orbs */}
          <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -right-32 w-[30rem] h-[30rem] bg-indigo-400/10 rounded-full blur-3xl pointer-events-none" />

          {/* Micro dot grid texture */}
          <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:28px_28px] opacity-40 pointer-events-none" />

          {/* Institutional Top Header */}
          <div className="relative z-10 flex items-center justify-between w-full max-w-5xl mx-auto pb-4 sm:pb-6 border-b border-slate-200/80">
            <div className="flex items-center gap-3.5 sm:gap-4">
              <img src="/isufst-logo.png" alt="ISUFST logo" className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-contain p-0.5 shadow-lg shadow-blue-600/25 shrink-0 bg-white" />
              <div className="leading-snug">
                <p className="text-sm sm:text-base md:text-lg font-black tracking-tight text-slate-900 uppercase">
                  {schoolBrand.name}
                </p>
                <p className="text-xs sm:text-sm font-semibold text-blue-600 tracking-wider uppercase">
                  Smart Gate Automated Terminal • Gate 01 • Main Entrance
                </p>
              </div>
            </div>

            {/* Live Clock & Node status badge */}
            <div className="flex items-center gap-2.5 sm:gap-3">
              {currentTime && (
                <div className="flex items-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-2xl bg-white border border-slate-200/90 shadow-sm text-sm sm:text-base font-mono font-bold text-slate-800">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <span>{currentTime}</span>
                </div>
              )}
              <div className="flex items-center gap-2.5 px-4 py-2 sm:px-5 sm:py-2.5 rounded-2xl bg-blue-50 border border-blue-200/90 shadow-sm text-sm sm:text-base font-bold text-blue-700">
                <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                <span>Booting</span>
              </div>
            </div>
          </div>

          {/* Center Stage — AI Initialization Radar & Progress */}
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-3xl mx-auto py-6 sm:py-10 space-y-6 sm:space-y-8 text-center">
            {/* Multi-Ring Neural Scanning Emblem */}
            <div className="relative mx-auto w-36 h-36 sm:w-48 sm:h-48 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 animate-ping opacity-40" />
              <div className="absolute -inset-3 sm:-inset-4 rounded-full border-2 border-dashed border-blue-400/50 animate-[spin_12s_linear_infinite]" />
              <div className="absolute -inset-7 sm:-inset-8 rounded-full border border-blue-300/25" />
              <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-3xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-2xl shadow-blue-600/35">
                <Cpu className="w-14 h-14 sm:w-18 sm:h-18 text-white stroke-[1.75] animate-pulse" />
              </div>
            </div>

            {/* Title & Status Message */}
            <div className="space-y-3 max-w-xl mx-auto">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs sm:text-sm font-extrabold tracking-widest uppercase shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" /> SYSTEM INITIALIZATION
              </div>
              <h1 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight">
                Loading Neural AI Engines
              </h1>
              <p className="text-base sm:text-xl font-bold text-blue-600">{statusMessage}</p>
            </div>

            {/* Glowing Pulse Progress Bar */}
            <div className="w-full max-w-lg mx-auto">
              <div className="h-3 w-full bg-slate-200/80 rounded-full overflow-hidden p-0.5 border border-slate-300/40 shadow-inner">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-sky-400 animate-pulse w-full" />
              </div>
              <p className="text-xs sm:text-sm text-slate-400 font-medium mt-3">
                Calibrating on-device computer vision models • Please wait
              </p>
            </div>

            {/* 3 Subsystem Status Badges */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4 w-full max-w-xl text-left">
              <div className="p-3.5 sm:p-4 rounded-2xl bg-white/90 border border-slate-200/90 shadow-sm flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3 text-center sm:text-left">
                <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                  <UserCheck className="w-5 h-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                    Face Biometric
                  </p>
                  <p className="text-[11px] text-emerald-600 font-semibold">Active</p>
                </div>
              </div>
              <div className="p-3.5 sm:p-4 rounded-2xl bg-white/90 border border-slate-200/90 shadow-sm flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3 text-center sm:text-left">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                  <Lock className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                    Policy Engine
                  </p>
                  <p className="text-[11px] text-indigo-600 font-semibold">Pass + lockdown</p>
                </div>
              </div>
              <div className="p-3.5 sm:p-4 rounded-2xl bg-white/90 border border-slate-200/90 shadow-sm flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3 text-center sm:text-left">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                    Auto Barrier
                  </p>
                  <p className="text-[11px] text-emerald-600 font-semibold">Ready</p>
                </div>
              </div>
            </div>
          </div>

          {/* Institutional Footer */}
          <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-2 w-full max-w-5xl mx-auto pt-4 sm:pt-6 border-t border-slate-200/80 text-xs sm:text-sm font-semibold text-slate-500">
            <span>Authorized University Access • Edge Neural Inference</span>
            <span>{schoolBrand.initials} Automated Terminal • Gate 01</span>
          </div>
        </div>
      )}

      {/* ─── Full-Screen Error / Diagnostic Display ─────────── */}
      {kioskState === "error" && (
        <div className="absolute inset-0 z-50 bg-[#f8fafc] flex flex-col justify-between p-6 sm:p-10 lg:p-14 select-none overflow-y-auto">
          {/* Ambient red warning glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-rose-400/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:28px_28px] opacity-40 pointer-events-none" />

          {/* Top Header */}
          <div className="relative z-10 flex items-center justify-between w-full max-w-5xl mx-auto pb-4 sm:pb-6 border-b border-slate-200/80">
            <div className="flex items-center gap-3.5 sm:gap-4">
              <img src="/isufst-logo.png" alt="ISUFST logo" className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-contain p-0.5 shadow-lg shadow-rose-600/25 shrink-0 bg-white" />
              <div className="leading-snug">
                <p className="text-sm sm:text-base md:text-lg font-black tracking-tight text-slate-900 uppercase">
                  Iloilo State University of Fisheries and Science and Technology
                </p>
                <p className="text-xs sm:text-sm font-semibold text-rose-600 tracking-wider uppercase">
                  Terminal System Diagnostic • Gate 01
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 px-4 py-2 sm:px-5 sm:py-2.5 rounded-2xl bg-rose-50 border border-rose-200/90 shadow-sm text-sm sm:text-base font-bold text-rose-700">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>Fault</span>
            </div>
          </div>

          {/* Center Alert */}
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-2xl mx-auto py-6 sm:py-10 space-y-6 sm:space-y-8 text-center">
            <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-3xl bg-rose-50 border-2 border-rose-200 flex items-center justify-center shadow-xl shadow-rose-600/10">
              <AlertCircle className="w-12 h-12 sm:w-16 sm:h-16 text-rose-600" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
                System Initialization Fault
              </h1>
              <p className="text-base sm:text-lg font-semibold text-rose-600 max-w-md mx-auto">
                {statusMessage}
              </p>
              <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mt-2">
                The terminal encountered a hardware or model startup error. Touch below to reboot
                the subsystem.
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full max-w-md py-5 px-8 rounded-2xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-black text-xl shadow-xl shadow-rose-600/30 transition-all cursor-pointer"
            >
              Reboot Terminal
            </button>
          </div>

          {/* Footer */}
          <div className="relative z-10 text-center w-full max-w-5xl mx-auto pt-4 sm:pt-6 border-t border-slate-200/80 text-xs sm:text-sm font-semibold text-slate-500">
            If problem persists, notify Campus ICT or Security Station
          </div>
        </div>
      )}

      {/* ─── Grant/Deny Flash ────────────────────────── */}
      {kioskState === "granted" && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className="absolute inset-0 bg-emerald-500/10 animate-pulse" />
        </div>
      )}

      {kioskState === "denied" && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className="absolute inset-0 bg-rose-500/10 animate-pulse" />
        </div>
      )}

      {/* ─── Big grant card ──────────────────────────────── */}
      {/* The moment a student passes the uniform check the whole screen says so:
          name, course, and the uniform line that authorized it. It lives on the
          same 5s card timer as everything else (RESULT_CARD_MIN_HOLD_MS) and
          unmounts when the card clears, so it never sits over the next arrival. */}
      {kioskState === "granted" && slotPhases[0] === "granted" && slotCardsRef.current[0] && (
        <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-3xl border-4 border-emerald-400 bg-emerald-50/95 backdrop-blur-md shadow-2xl px-5 py-7 sm:px-8 sm:py-9 text-center">
            <div className="mx-auto flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-emerald-500 shadow-lg">
              <CheckCircle2 className="h-9 w-9 sm:h-10 sm:w-10 text-white" strokeWidth={3} />
            </div>
            <p className="mt-3 text-xs sm:text-sm font-black tracking-[0.3em] text-emerald-700">
              ACCESS GRANTED
            </p>
            <p className="mt-2 text-2xl sm:text-4xl font-black leading-tight tracking-tight text-emerald-950">
              {slotCardsRef.current[0]?.name}
            </p>
            <p className="mt-1 text-sm sm:text-base font-bold text-emerald-800 truncate">
              {slotCardsRef.current[0]?.department || "Student"}
            </p>
            {slotCardsRef.current[0]?.uniform ? (
              <p className="mx-auto mt-3 max-w-md rounded-xl bg-white/80 px-3 py-2 text-xs sm:text-sm font-semibold leading-snug text-emerald-900">
                {slotCardsRef.current[0]?.uniform}
              </p>
            ) : null}
            <p className="mt-4 text-[10px] sm:text-[11px] font-black uppercase tracking-[0.22em] text-emerald-600">
              {gateSecondsLeft !== null && gateSecondsLeft > 0
                ? `Gate open · ${gateSecondsLeft}s`
                : "Gate clearing"}
            </p>
          </div>
        </div>
      )}

      {/* ─── Bottom Status Panel (Centered, High Legibility) ────── */}
      {/* One panel under the one oval, capped in width so a 1920 px kiosk does
          not stretch a two-line result across the whole screen. */}
      {(kioskState === "ready" || kioskState === "scanning" || kioskState === "denied") && (
        <div
          className="absolute inset-x-0 z-30 pointer-events-none grid grid-cols-1 gap-2 sm:gap-6 px-3 sm:px-8 max-w-xl mx-auto"
          style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          {[0].map((slot) => {
            const phase = slotPhases[slot];
            const detail = slotDetails[slot];
            const card = slotCardsRef.current[slot];
            const tone =
              phase === "granted" || phase === "confirmed"
                ? "border-emerald-400/70 bg-emerald-50/95 text-emerald-900"
                : phase === "unknown"
                  ? "border-amber-400/80 bg-amber-50/95 text-amber-900"
                  : phase === "denied"
                    ? "border-rose-400/80 bg-rose-50/95 text-rose-900"
                    : "border-white/50 bg-white/85 text-surface-700";
            const title =
              phase === "granted"
                ? "WELCOME"
                : phase === "confirmed"
                  ? "IDENTITY VERIFIED"
                  : phase === "unknown"
                    ? "UNKNOWN FACE"
                    : phase === "denied"
                      ? "ACCESS DENIED"
                      : phase === "verifying"
                        ? "VERIFYING"
                        : "STUDENT";

            return (
              <div key={slot} className="flex min-w-0 flex-col items-stretch gap-1">
                <span className="self-center text-[10px] font-black tracking-[0.22em] text-white/85 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                  STAND HERE
                </span>
                <div className={`rounded-2xl border-2 px-3 py-2.5 sm:px-4 sm:py-3 shadow-xl backdrop-blur-md ${tone}`}>
                  <p className="text-[11px] sm:text-xs font-black tracking-widest">{title}</p>
                  {(phase === "confirmed" || phase === "granted") && card ? (
                    <>
                      <p className="text-base sm:text-xl font-black tracking-tight truncate leading-tight">
                        {card.name}
                      </p>
                      <p className="text-[11px] sm:text-xs font-semibold opacity-80 truncate">
                        {card.department || "Student"}
                        {card.confidence > 0 && ` · ${Math.round(card.confidence * 100)}%`}
                      </p>
                      {card.uniform ? (
                        <p className="text-[11px] sm:text-xs font-semibold opacity-80 truncate">
                          {card.uniform}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-[11px] sm:text-sm font-semibold opacity-80 leading-snug">
                      {phase === "unknown"
                        ? `${detail} — see the guard station`
                        : phase === "denied"
                          ? detail || "See the guard station"
                          : phase === "verifying"
                            ? "Hold still — reading your face"
                            : "Step into this oval"}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Last result strip ───────────────────────────── */}
      {/* The verdict card clears after a few seconds, which left the screen with
          no trace of what just happened. This keeps the latest decision visible
          while the student walks on, then clears itself. */}
      {/* School-ID QR status — accepted as the fallback when the face fails */}
      {allowQr && kioskState !== "error" && (
        <div
          className="absolute right-3 sm:right-10 z-30 pointer-events-none flex items-center gap-2 rounded-lg bg-white/90 backdrop-blur-md px-3 py-1.5 shadow-sm border border-white/40"
          style={{
            top: portrait
              ? "max(9rem, calc(env(safe-area-inset-top) + 8rem))"
              : "max(5.5rem, calc(env(safe-area-inset-top) + 4.5rem))",
          }}
        >
          <span className="text-[10px] font-black tracking-widest text-surface-500 uppercase">School ID</span>
          <span className={`text-[11px] font-mono font-bold ${qrSeen ? "text-emerald-700" : "text-amber-700"}`}>
            {qrSeen ? qrSeen.studentId : "SCAN QR"}
          </span>
        </div>
      )}

      {lastDecision &&
      !holdNotice &&
      !unknownNotice &&
      kioskState !== "granted" &&
      kioskState !== "denied" &&
      !(lastMatch?.matched && lastMatch.person && lastMatch.person.id !== lastDecision.personId) && (
        <div className="absolute left-4 sm:left-10 z-30 pointer-events-none flex items-center gap-2 rounded-lg bg-white/90 backdrop-blur-md px-3 py-1.5 shadow-sm border border-white/40" style={{ bottom: "max(7rem, calc(env(safe-area-inset-bottom) + 6rem))" }}>
          <span className="text-[10px] font-black tracking-widest text-surface-500 uppercase">
            Last
          </span>
          <span className="text-[13px] font-bold text-surface-900">{lastDecision.name}</span>
          <span
            className={`text-[11px] font-mono font-bold ${
              lastDecision.granted ? "text-emerald-700" : "text-rose-600"
            }`}
          >
            {lastDecision.granted ? "GRANTED" : "DENIED"}
          </span>
          <span className="text-[11px] font-mono text-surface-500">
            {new Date(lastDecision.at).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
      )}

      {/* ─── Floating gate banner ──────────────────── */}
      {/* The verdict card clears after 8s, but a real barrier stays open for
          its configured window — the banner must live exactly as long. */}
      {isDecisionGateBanner(gateState) && kioskState !== "granted" && kioskState !== "denied" && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 top-[max(1.5rem,env(safe-area-inset-top))] z-30 pointer-events-none flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 shadow-lg backdrop-blur-md text-sm font-black max-w-[calc(100vw-2rem)] ${
            gateState === "OPEN"
              ? "text-emerald-800 bg-emerald-50/90 border-emerald-200"
              : gateState === "AWAITING"
                ? "text-amber-800 bg-amber-50/90 border-amber-200"
                : "text-surface-700 bg-white/80 border-surface-200"
          }`}
        >
          <span className="flex items-center gap-3 min-w-0">
            <span
              className={`w-2.5 h-2.5 shrink-0 rounded-full ${
                gateState === "OPEN" ? "bg-emerald-500 animate-ping" : "bg-amber-500"
              }`}
            />
            <span className="truncate">
              {gateState === "OPEN"
                ? "Turnstile Barrier OPEN — please proceed"
                : gateState === "AWAITING"
                  ? "Gate command sent — awaiting controller confirmation"
                  : "Gate command sent — no controller linked"}
            </span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {gateSecondsLeft !== null && gateSecondsLeft > 0 && (
              <span className="font-mono text-xs opacity-80">{gateSecondsLeft}s</span>
            )}
            {gateState === "SENT" && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-black tracking-widest bg-surface-200 text-surface-600">
                DEMO
              </span>
            )}
          </span>
        </div>
      )}

      {/* ─── Operator Panel ──────────────────────────────── */}
      {showAdminPanel && (
        <div className="absolute top-24 left-4 right-4 sm:left-auto sm:right-8 z-40 glass-card p-5 sm:p-6 sm:w-96 max-h-[calc(100dvh-7rem)] overflow-y-auto shadow-2xl space-y-5 bg-white/95 border border-surface-200">
          <div className="flex items-center justify-between border-b border-surface-100 pb-3">
            <h3 className="font-bold text-surface-900 tracking-tight text-lg">Operator Panel</h3>
            <button
              onClick={() => setShowAdminPanel(false)}
              className="text-surface-400 hover:text-surface-600 p-2 rounded-lg hover:bg-surface-100 transition-colors cursor-pointer"
              aria-label="Close admin panel"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm font-medium bg-surface-50/70 p-4 rounded-xl border border-surface-200/50">
            <div className="flex justify-between">
              <span className="text-surface-500">Network</span>
              <span className={`font-bold ${online ? "text-green-600" : "text-red-500"}`}>
                {online ? "ONLINE" : "OFFLINE"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Gate</span>
              <span className={`font-bold ${gateConnected ? "text-green-600" : "text-red-500"}`}>
                {gateConnected ? `LINKED (${gateTransport === "wifi" ? "WIFI" : "USB"})` : "OFF"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Gate state</span>
              <span className="font-mono font-bold text-surface-900">{gateState ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">FPS</span>
              <span className="font-mono font-bold text-surface-900">{fps}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Camera</span>
              <span className={`font-bold ${cameraDown ? "text-amber-600" : "text-green-600"}`}>
                {cameraDown ? "OFF" : "OK"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Profiles</span>
              <span className="font-mono font-bold text-surface-900">{dbStats.studentCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Face templates</span>
              <span
                className={`font-mono font-bold ${
                  enrollmentHealth.total > 0 && enrollmentHealth.withFace < enrollmentHealth.total
                    ? "text-amber-600"
                    : "text-surface-900"
                }`}
              >
                {enrollmentHealth.withFace}/{enrollmentHealth.total}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-surface-500">Pending sync</span>
              <button
                onClick={openQueueModal}
                className="flex items-center gap-1.5 font-mono font-bold text-primary-600 hover:text-primary-500 cursor-pointer"
                title="Open the offline queue"
              >
                <span className={dbStats.unsyncedCount > 0 ? "text-amber-600" : "text-surface-900"}>
                  {dbStats.unsyncedCount}
                </span>
                <span className="text-[10px] font-black uppercase tracking-wider underline">
                  View queue
                </span>
              </button>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Uniform vision</span>
              <span
                className={`font-bold ${uniformEnforced ? "text-green-600" : "text-surface-400"}`}
              >
                {uniformEnforced ? "ON — REQUIRED" : "OFF"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Entry policy</span>
              <span className={`font-bold ${uniformEnforced ? "text-green-600" : "text-surface-400"}`}>
                {uniformEnforced ? "FACE + UNIFORM" : "FACE + PASS"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Last sync</span>
              <span className="font-mono text-xs font-bold text-surface-900">
                {lastSyncRef.current ? new Date(lastSyncRef.current).toLocaleTimeString() : "—"}
              </span>
            </div>
          </div>

          {enrollmentHealth.total > 0 && enrollmentHealth.withFace < enrollmentHealth.total && (
            <div className="bg-amber-50 text-amber-800 p-3 rounded-xl text-sm font-medium border border-amber-200 space-y-1">
              <div className="font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {enrollmentHealth.total - enrollmentHealth.withFace} profile
                {enrollmentHealth.total - enrollmentHealth.withFace === 1 ? "" : "s"} cannot be
                recognized
              </div>
              <p className="text-xs leading-relaxed">
                No face was detected in the enrollment photo, so no biometric template exists. These
                students will always be denied. Re-enroll them at the Guard Station with a clear,
                well-lit, front-facing photo.
              </p>
              <p className="text-xs font-semibold">{enrollmentHealth.missing.join(", ")}</p>
            </div>
          )}

          {syncStatus && (
            <div className="bg-primary-50 text-primary-700 p-3 rounded-xl text-sm font-medium border border-primary-100">
              {syncStatus}
            </div>
          )}

          {/* Hardware self-test — deliberately camera-free, for bench testing. */}
          <div className="rounded-xl border border-surface-200 bg-surface-50/70 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-surface-500">
                Servo / ESP32 test
              </span>
              <span
                className={`text-[10px] font-black uppercase tracking-widest ${
                  gateConnected ? "text-green-600" : "text-rose-500"
                }`}
              >
                {gateConnected
                  ? `linked · ${gateTransport === "wifi" ? "wifi" : "usb"}`
                  : "no link"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleTestPulse("open")}
                disabled={hwTest.running}
                className="py-2.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold hover:bg-emerald-100 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Open
              </button>
              <button
                onClick={() => handleTestPulse("close")}
                disabled={hwTest.running}
                className="py-2.5 rounded-lg bg-surface-100 text-surface-700 border border-surface-200 text-xs font-bold hover:bg-surface-200 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>

            <button
              onClick={runServoSelfTest}
              disabled={hwTest.running}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              {hwTest.running ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Cpu className="w-3.5 h-3.5" />
              )}
              {hwTest.running ? hwTest.result : "Run self-test"}
            </button>

            {hwTest.result && !hwTest.running && (
              <p
                className={`text-[11px] font-semibold leading-snug ${
                  hwTest.ok ? "text-emerald-700" : "text-rose-600"
                }`}
              >
                {hwTest.result}
              </p>
            )}

            <p className="text-[11px] leading-snug text-surface-500">
              No camera needed. The GPIO 4 button also opens the gate by itself — tap it to check
              the ESP32 and servo without this screen.
            </p>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleManualSync}
                className="btn-primary w-full flex items-center justify-center gap-2"
                disabled={!online}
              >
                <RefreshCw className="w-4 h-4" /> Force Sync
              </button>
              <button
                onClick={openQueueModal}
                className="w-full text-sm px-5 py-3 rounded-xl font-bold transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200"
              >
                <Database className="w-4 h-4" />
                Queue{dbStats.unsyncedCount > 0 ? ` (${dbStats.unsyncedCount})` : ""}
              </button>
            </div>

            <button
              onClick={handleConnectGate}
              className={`w-full text-sm px-5 py-3 rounded-xl font-bold transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer ${
                gateConnected
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-surface-100 hover:bg-surface-200 text-surface-700 border border-surface-200"
              }`}
            >
              {gateConnected ? (
                <>
                  <CheckCircle2 className="w-4 h-4" /> Gate Linked (
                  {gateTransport === "wifi" ? "Wi-Fi" : "USB"})
                </>
              ) : (
                <>
                  <Plug className="w-4 h-4" /> Bind Gate
                </>
              )}
            </button>

            {/* Voice toggle + test sound */}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                onClick={handleToggleVoice}
                className={`w-full text-sm px-5 py-3 rounded-xl font-bold transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer ${
                  voiceOn
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-surface-100 hover:bg-surface-200 text-surface-700 border border-surface-200"
                }`}
              >
                <Volume2 className="w-4 h-4" /> Voice {voiceOn ? "ON" : "OFF"}
              </button>
              <button
                onClick={handleTestVoice}
                className="px-4 py-3 rounded-xl font-bold text-sm bg-primary-50 hover:bg-primary-100 text-primary-700 border border-primary-200 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                title="Play the grant chime + welcome message"
                aria-label="Test voice sound"
              >
                <Play className="w-4 h-4" /> Test
              </button>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="w-full text-sm px-5 py-3 rounded-xl font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" /> Reboot Terminal
            </button>
          </div>
        </div>
      )}

      {/* ─── Offline queue modal: every row waiting in IndexedDB ─── */}
      {showQueueModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <div
            className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm"
            onClick={() => setShowQueueModal(false)}
          />
          <div className="relative w-full max-w-2xl max-h-[86vh] bg-white rounded-3xl shadow-2xl border border-surface-200 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
                  <Database className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-black text-surface-900 text-lg tracking-tight">
                    Offline Queue
                  </h3>
                  <p className="text-xs font-medium text-surface-500">
                    {queueLogs.length === 0
                      ? "Nothing waiting — every scan is in the cloud"
                      : `${queueLogs.length} scan${queueLogs.length === 1 ? "" : "s"} stored on this device, waiting for upload`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowQueueModal(false)}
                className="text-surface-400 hover:text-surface-600 p-2 rounded-lg hover:bg-surface-100 transition-colors cursor-pointer"
                aria-label="Close offline queue"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {queueLoading ? (
                <p className="text-center text-sm font-bold text-surface-400 py-10">
                  Reading device storage…
                </p>
              ) : queueLogs.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7 text-green-500" />
                  </div>
                  <p className="font-bold text-surface-900 text-sm">Queue is empty</p>
                  <p className="text-surface-500 font-medium text-xs mt-1">
                    New scans appear here automatically when the network drops.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-surface-50">
                  {queueLogs.map((log) => (
                    <div key={log.id ?? log.sync_id} className="flex items-center gap-3 py-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          log.success ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"
                        }`}
                      >
                        {log.success ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <XCircle className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-surface-900 truncate">
                          {log.person_name || "Unknown person"}
                        </p>
                        <p className="text-[11px] font-semibold text-surface-400 uppercase truncate">
                          {log.method || "face"} · {log.success ? "granted" : "denied"}
                          {log.decision_note ? ` · ${log.decision_note}` : log.failure_reason ? ` · ${log.failure_reason}` : ""}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-surface-400 shrink-0 font-mono">
                        {new Date(log.device_timestamp).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-surface-100 flex flex-col sm:flex-row gap-2">
              <button
                onClick={syncQueueNow}
                disabled={!online || queueSyncing || queueLogs.length === 0}
                className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <RefreshCw className={`w-4 h-4 ${queueSyncing ? "animate-spin" : ""}`} />
                {queueSyncing ? "Syncing…" : online ? "Sync now" : "Offline — connect to sync"}
              </button>
              <button
                onClick={() => setShowQueueModal(false)}
                className="px-5 py-3 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-xl text-sm font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

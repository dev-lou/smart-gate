"use client";

import { useEffect, useRef, useState } from "react";
import {
  initFaceDetector,
  initFaceRecognizer,
  detectFaces,
  detectFacesFromCanvas,
  getFaceEmbedding,
  getFaceEmbeddingFromCanvas,
  matchFace,
  cleanupFaceResources,
  type FaceResult,
  type EnrolledFace,
  type MatchResult,
} from "@/lib/face";
import {
  checkUniform,
  initUniformDetector,
  cleanupUniformDetector,
  isYoloModelLoaded,
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
  LAST_RESULT_HOLD_MS,
  NOTICE_WINDOW_MS,
  NOTICE_ABSENCE_CLEAR_MS,
  VERDICT_HOLD_MS,
  clampGateWindow,
  gateStateForLog,
  isRepeatDecision,
  isSettledUnknown,
  nextPresence,
  resolveGateOutcome,
  shouldDecide,
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
  type StoredStudent,
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
  Scan,
  Sparkles,
  Clock,
  Lock,
  Shirt,
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
 *   uniform   → identity matched, reading the uniform
 *   done      → a verdict was reached (grant/deny card takes over)
 */
type ScanStep = "searching" | "face" | "uniform" | "done";

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
  if (!box.width || !box.height) return;
  const style = overlayCanvas.style;
  style.left = `${box.left}px`;
  style.top = `${box.top}px`;
  style.width = `${box.width}px`;
  style.height = `${box.height}px`;
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
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/55 backdrop-blur-md shadow-sm text-[10px] sm:text-xs font-black uppercase tracking-wider ${styles[state]}`}
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
  const [lastUniform, setLastUniform] = useState<UniformCheckResult | null>(null);
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
    granted: boolean;
    at: number;
  } | null>(null);
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
  const settingsRef = useRef<{
    uniformEnabled: boolean;
    matchThreshold: number;
    /** Gate open window from Settings — how long the barrier stays released. */
    gateOpenDuration: number;
  }>({
    uniformEnabled: true,
    matchThreshold: 0.6,
    gateOpenDuration: 5,
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
  const lastRecognizedAtRef = useRef(0);
  const lastUniformRef = useRef<UniformCheckResult | null>(null);
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
  /** Render-loop mirror of `holdNotice` — safe to read inside the rAF loop. */
  const holdNoticeRef = useRef<{
    kind: "granted" | "denied";
    name: string;
    at: number;
    personId?: string;
    detail?: string;
  } | null>(null);

  // Keep the overlay ref in lockstep with the uniform result — the animation
  // loop reads refs so it never has to be re-created when a check completes.
  useEffect(() => {
    lastUniformRef.current = lastUniform;
  }, [lastUniform]);

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
  function rememberDecision(name: string, granted: boolean) {
    setLastDecision({ name, granted, at: Date.now() });
    if (lastDecisionTimerRef.current) clearTimeout(lastDecisionTimerRef.current);
    lastDecisionTimerRef.current = setTimeout(() => setLastDecision(null), LAST_RESULT_HOLD_MS);
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

      // 1. Load AI models
      const [faceDetectorLoaded, uniformLoaded] = await Promise.all([
        initFaceDetector().catch(() => false),
        initUniformDetector().catch(() => false),
      ]);

      if (!faceDetectorLoaded) {
        setStatusMessage("⚠️ Face detector failed to load");
        setTimeout(() => setKioskState("ready"), 2000);
      }

      setStatusMessage("Loading face recognition model...");
      const recognizerLoaded = await initFaceRecognizer().catch(() => false);

      if (!recognizerLoaded) {
        console.warn("Face recognizer not available, running in detection-only mode");
      }

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
      syncOverlayToVideo(overlayCanvas, video);

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
            // deeper into the pipeline (identity/uniform), which would make
            // the HUD flicker backwards while a check is running.
            setScanStep((prev) => (prev === "uniform" || prev === "done" ? prev : "face"));
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
          // Largest face in frame is the person at the gate.
          const largestFace = detected.reduce((a, b) =>
            a.bbox[2] * a.bbox[3] > b.bbox[2] * b.bbox[3] ? a : b,
          );
          await processFace(largestFace, video, canvas);
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

  async function processFace(face: FaceResult, video: HTMLVideoElement, canvas: HTMLCanvasElement) {
    // Get face embedding
    const embedding = await getFaceEmbedding(video, face.bbox, canvas);
    if (!embedding) return;

    // Match against enrolled faces
    const match = matchFace(embedding, enrolledRef.current, settingsRef.current.matchThreshold);
    lastMatchRef.current = match;
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
    // either we are about to read the uniform or this face is unknown.
    setScanStep(match.matched ? "uniform" : settledUnknown ? "done" : "face");

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
        setLastUniform(null);
        setHoldNotice({
          kind: "granted",
          name: match.person.name,
          at: prev.at,
          personId: match.person.id,
        });
        return;
      }
    }

    // Check uniform if matched
    let uniformCheck: UniformCheckResult | null = null;
    if (match.matched && match.person && settingsRef.current.uniformEnabled) {
      uniformCheck = await checkUniform(video, face.bbox, match.person.uniform_type, canvas);
      setLastUniform(uniformCheck);
    }

    // Determine access
    const accessGranted =
      match.matched && (!settingsRef.current.uniformEnabled || uniformCheck?.ok === true);

    if (accessGranted) {
      // Grant access — the card timer must know it owns the screen (a new
      // decision can land while this card's hold window is still running).
      const cardToken = ++decisionSeqRef.current;
      setKioskState("granted");
      playCue("grant");
      setStatusMessage(`Welcome, ${match.person!.name}!`);

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
      const isRepeatGrant = isRepeatDecision({
        lastDecisionAt: lastDecisionByPersonRef.current.get(match.person!.id)?.at ?? 0,
        now: grantedAt,
      });
      if (!isRepeatGrant)
        lastDecisionByPersonRef.current.set(match.person!.id, { at: grantedAt, granted: true });
      rememberDecision(match.person!.name, true);
      setHoldNotice({
        kind: "granted",
        name: match.person!.name,
        at: grantedAt,
        personId: match.person!.id,
      });

      // Log access (with gate feedback result)
      if (!isRepeatGrant) {
        await addLog({
          person_id: match.person!.id,
          person_name: match.person!.name,
          person_type: "student",
          direction: "entry",
          method: "face",
          success: true,
          confidence: match.confidence,
          uniform_ok: uniformCheck?.ok ?? null,
          failure_reason: uniformCheck
            ? `Uniform verified — ${uniformCheck.detail}`
            : "Granted — uniform check disabled in settings",
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
        setLastUniform(null);
        // The barrier banner outlives the verdict card when the configured
        // open window is longer than the card hold — clear it only once the
        // window has actually elapsed (the countdown effect handles the rest).
        if (gateBannerUntilRef.current === 0 || Date.now() >= gateBannerUntilRef.current) {
          setGateState(null);
          setGateSecondsLeft(null);
        }
      }, VERDICT_HOLD_MS);
    } else if (match.matched && uniformCheck && !uniformCheck.ok) {
      // Denied due to uniform — policy feedback only, no personal data
      const cardToken = ++decisionSeqRef.current;
      setKioskState("denied");
      playCue("deny");
      setStatusMessage(uniformCheck.detail);

      // Same duplicate guard as a grant: a failed uniform check must not be
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
      rememberDecision(match.person!.name, false);
      setHoldNotice({
        kind: "denied",
        name: match.person!.name,
        at: deniedAt,
        personId: match.person!.id,
        detail: uniformCheck.detail,
      });

      if (!isRepeatDenial) {
        await addLog({
          person_id: match.person!.id,
          person_name: match.person!.name,
          person_type: "student",
          direction: "entry",
          method: "face",
          success: false,
          confidence: match.confidence,
          uniform_ok: false,
          failure_reason: uniformCheck.detail,
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
          setLastUniform(null);
        }
      }, 4000);
    } else {
      // Unknown face — soft throttled beep, no voice (never talk to strangers)
      setKioskState("ready");
      setStatusMessage("Scanning...");
      // Only cue once the read has settled — no beep at someone who is still
      // walking up and is about to match.
      const decision = shouldPlayBeep(lastUnknownBeepRef.current, Date.now());
      lastUnknownBeepRef.current = decision.lastPlayedAt;
      if (settledUnknown && decision.play) playCue("unknown");
      // Deliberately no audit row here. access_logs records identified
      // students — granted, or denied for uniform — and nothing else; an
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
   *   1. no face  → animated face oval + "position your face" guidance
   *   2. face     → reticle around the detected face + detection confidence,
   *                 with a sweeping scan line while it works
   *   3. uniform  → a second reticle on the winning YOLO detection (the
   *                 garment itself) with its class label + confidence,
   *                 green when it matches the course and red when it doesn't
   *
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
    const uniform = lastUniformRef.current;
    const verifying = state === "ready" || state === "scanning";

    // Hold the reticle briefly after a detection miss (blinks, head turns) so
    // the box does not strobe, then let it fade out — a hard cut looks broken.
    const faceAge = now - lastFaceAtRef.current;
    const faces = faceAge < FACE_RETICLE_HOLD_MS ? lastFacesRef.current : [];
    const reticleAge = faces.length > 0 ? Math.max(0, faceAge) : 0;
    const reticleAlpha = Math.max(0.25, 1 - reticleAge / FACE_RETICLE_HOLD_MS);

    const unit = W / 100; // scale everything off the frame width

    // ── 1. Nobody in frame: show the guide so people know where to stand ──
    if (faces.length === 0 && verifying) {
      const gw = Math.min(W * 0.46, H * 0.5);
      const gh = gw * 1.34;
      const gx = (W - gw) / 2;
      const gy = H * 0.48 - gh / 2;
      // Kept deliberately faint: this is a hint, not a mask. A student should
      // see their own face clearly while they line up.
      const pulse = 0.3 + 0.22 * Math.sin(now / 430);

      ctx.save();
      ctx.setLineDash([unit * 2.2, unit * 1.9]);
      ctx.lineDashOffset = -((now / 26) % 1000);
      ctx.lineWidth = Math.max(2.5, unit * 0.4);
      ctx.strokeStyle = `rgba(255, 255, 255, ${pulse})`;
      ctx.beginPath();
      ctx.ellipse(W / 2, gy + gh / 2, gw / 2, gh / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      drawBrackets(ctx, gx, gy, gw, gh, "255, 255, 255", 0.32, Math.max(2, unit * 0.4), unit * 6);
      drawChip(
        ctx,
        W / 2,
        Math.min(H - unit * 12, gy + gh + unit * 7),
        "POSITION YOUR FACE IN THE OVAL",
        "59, 130, 246",
        "center",
        Math.max(13, unit * 2.1),
      );
    }

    // ── 2. Face reticle(s) ──
    for (const face of faces) {
      const [x, y, w, h] = face.bbox;
      const bx = x * W;
      const by = y * H;
      const bw = w * W;
      const bh = h * H;

      const rgb =
        state === "denied"
          ? "244, 63, 94"
          : state === "granted" || match?.matched
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

    // ── 2b. Torso scan band: the region actually fed to YOLO ──
    // checkUniform() crops this band under the chin and letterboxes it to
    // 640x640. Drawing it faintly answers "what is the uniform AI looking
    // at?" and shows the student where to hold their torso in frame.
    if (verifying && faces.length > 0) {
      const biggest = faces.reduce((a, b) =>
        a.bbox[2] * a.bbox[3] > b.bbox[2] * b.bbox[3] ? a : b,
      );
      const band = torsoRegion(biggest.bbox, { videoWidth: W, videoHeight: H });
      const tx = Math.max(0, Math.min(W - 1, band.x));
      const ty = Math.max(0, Math.min(H - 1, band.y));
      const tw = Math.max(1, Math.min(W - tx, band.width));
      const th = Math.max(1, Math.min(H - ty, band.height));
      if (tw > 4 && th > 4) {
        ctx.save();
        ctx.setLineDash([unit * 1.1, unit * 1.1]);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.55)";
        ctx.lineWidth = Math.max(1.5, unit * 0.22);
        ctx.strokeRect(tx, ty, tw, th);
        ctx.restore();
        drawChip(
          ctx,
          tx,
          Math.max(unit * 7, ty - unit * 1.2),
          "UNIFORM SCAN AREA",
          "148, 163, 184",
          "left",
          Math.max(11, unit * 1.5),
        );
      }
    }

    // ── 3. Uniform reticle on the winning YOLO detection ──
    // The box survives into the verdict hold so the recorded decision stays
    // anchored to what the model actually saw.
    const showVerdict = state === "granted" || state === "denied";
    const uniformBox = verifying || showVerdict ? uniform?.bbox : undefined;
    if (uniformBox) {
      const [ux, uy, uw, uh] = uniformBox;
      const bx = ux * W;
      const by = uy * H;
      const bw = uw * W;
      const bh = uh * H;
      const rgb = uniform!.ok ? "16, 185, 129" : "244, 63, 94";

      ctx.save();
      ctx.setLineDash([unit * 1.6, unit * 1.2]);
      ctx.strokeStyle = `rgba(${rgb}, 0.5)`;
      ctx.lineWidth = Math.max(2, unit * 0.3);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
      drawBrackets(ctx, bx, by, bw, bh, rgb, 1, Math.max(4, unit * 0.8), Math.min(bw, bh) * 0.3);

      const garment = (uniform!.detectedType || "uniform")
        .replace(/_/g, " ")
        .replace(/\buniform\b/i, "")
        .trim()
        .toUpperCase();
      drawChip(
        ctx,
        bx,
        Math.max(unit * 7, by - unit * 1.5),
        `${uniform!.ok ? "\u2713" : "\u2715"} ${garment} \u00b7 ${Math.round(uniform!.confidence * 100)}%`,
        rgb,
        "left",
        Math.max(12, unit * 1.8),
      );
    } else if (verifying && match?.matched && uniform && !uniform.bbox) {
      // Identity matched but the model found no garment to score: tell the
      // person what to do instead of silently denying them.
      drawChip(
        ctx,
        W / 2,
        H - unit * 4,
        "NO UNIFORM VISIBLE \u2014 STEP BACK SO YOUR TORSO IS IN FRAME",
        "244, 63, 94",
        "center",
        Math.max(12, unit * 1.8),
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
            uniform_ok: null,
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
            if (!faces || faces.length === 0) {
              console.warn(`No face detected in photo for ${student.name}`);
              continue;
            }

            const largestFace = faces.reduce((a, b) =>
              a.bbox[2] * a.bbox[3] > b.bbox[2] * b.bbox[3] ? a : b,
            );

            const embedding = await getFaceEmbeddingFromCanvas(photoCanvas, largestFace.bbox);
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
    cleanupUniformDetector();
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
      const uniformEnabled = settings.find((s) => s.key === "uniform_detection_enabled");
      const threshold = settings.find((s) => s.key === "face_recognition_threshold");

      if (uniformEnabled) {
        settingsRef.current.uniformEnabled = uniformEnabled.value === "true";
      }
      if (threshold) {
        const parsed = parseFloat(threshold.value);
        if (!isNaN(parsed)) {
          settingsRef.current.matchThreshold = parsed;
        }
      }

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
          uniform: (lastUniform ? (lastUniform.ok ? "ok" : "fail") : "idle") as StepVisual,
          title: "You are already recorded — proceed to the gate",
          hint: `${holdNotice.name} passed at ${at}. Verified once — there is no need to scan again.`,
        };
      }

      if (holdNotice.kind === "denied" && stillCounts) {
        return {
          face: "ok" as StepVisual,
          identity: "ok" as StepVisual,
          uniform: "fail" as StepVisual,
          title: "Access denied — step away, then try again",
          hint:
            holdNotice.detail ??
            "The uniform did not match your course. Step out of the oval and back in to re-scan.",
        };
      }

      // Past the 60s window with the same student STILL standing there: the
      // scanner is holding their already-made decision, so say what gets them
      // a fresh one (a real step-out re-arms their identity).
      return {
        face: "ok" as StepVisual,
        identity: "ok" as StepVisual,
        uniform: "idle" as StepVisual,
        title: "You are already recorded — step aside to re-scan",
        hint: `${holdNotice.name} passed at ${at}. Step out of the oval briefly, then step back in to verify again.`,
      };
    }

    const matched = lastMatch?.matched ?? false;
    const uniformOk = lastUniform?.ok ?? null;

    let face: StepVisual = "working";
    let identity: StepVisual = "idle";
    let uniformStep: StepVisual = "idle";
    let title = "Step in front of the camera";
    let hint = "Face detection is live — the oval shows where to stand";

    if (scanStep === "searching") {
      face = "working";
    } else if (scanStep === "face") {
      face = "ok";
      identity = "working";
      title = "Face detected — hold still";
      hint = "Matching against enrolled biometric profiles";
    } else if (scanStep === "uniform") {
      face = "ok";
      identity = matched ? "ok" : "fail";
      uniformStep = "working";
      title = matched ? "Identity matched — checking uniform" : "Face not recognized";
      hint = matched
        ? "YOLO11 is reading your uniform against your course"
        : "No enrolled profile matched — see the guard station";
    } else if (scanStep === "done") {
      face = "ok";
      identity = matched ? "ok" : "fail";
      uniformStep = uniformOk === null ? "idle" : uniformOk ? "ok" : "fail";
      title = "Verification complete";
      hint = statusMessage;
    }

    // Once the uniform verdict lands, show exactly what the model saw.
    if (lastUniform && lastUniform.detail) {
      hint = lastUniform.detail;
    } else if (!matched && lastMatch && scanStep === "done") {
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
    } else if (matched) {
      hint = `Identity matched at ${Math.round((lastMatch?.confidence ?? 0) * 100)}%`;
    }

    return { face, identity, uniform: uniformStep, title, hint };
  })();

  return (
    <div className="relative w-screen h-screen bg-surface-50 overflow-hidden select-none">
      {/* ─── Tap-to-Start Splash (unlocks camera + audio) ── */}
      {showSplash && (
        <div
          onClick={handleStart}
          role="button"
          tabIndex={0}
          aria-label="Tap screen to start"
          className="absolute inset-0 z-50 bg-[#f8fafc] flex flex-col justify-between p-6 sm:p-10 lg:p-14 overflow-y-auto select-none cursor-pointer"
        >
          {/* Ambient luminous glow orbs (light theme) */}
          <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -right-32 w-[30rem] h-[30rem] bg-indigo-400/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-sky-300/5 rounded-full blur-[100px] pointer-events-none" />

          {/* Micro dot grid texture */}
          <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:28px_28px] opacity-40 pointer-events-none" />

          {/* Institutional Top Header (Edge-to-Edge Full Width) */}
          <div className="relative z-10 flex items-center justify-between w-full max-w-5xl mx-auto pb-4 sm:pb-6 border-b border-slate-200/80 pointer-events-none">
            <div className="flex items-center gap-3.5 sm:gap-4">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-tr from-blue-700 via-blue-600 to-indigo-600 flex items-center justify-center text-white font-black text-sm sm:text-base shadow-lg shadow-blue-600/25 shrink-0">
                {schoolBrand.initials}
              </div>
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
              <div className="flex items-center gap-2.5 px-4 py-2 sm:px-5 sm:py-2.5 rounded-2xl bg-emerald-50 border border-emerald-200/90 shadow-sm text-sm sm:text-base font-bold text-emerald-700">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Ready</span>
              </div>
            </div>
          </div>

          {/* Full-Screen Center Stage — Standing Eye Level Display */}
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-4xl mx-auto py-6 sm:py-10 space-y-6 sm:space-y-8 text-center pointer-events-auto">
            {/* Massive Biometric Scanning Emblem */}
            <div className="relative mx-auto w-32 h-32 sm:w-44 sm:h-44 md:w-52 md:h-52 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 animate-ping opacity-40" />
              <div className="absolute -inset-3 sm:-inset-4 rounded-full border-2 border-dashed border-blue-400/40 animate-[spin_25s_linear_infinite]" />
              <div className="absolute -inset-7 sm:-inset-8 rounded-full border border-blue-300/20" />
              <div className="w-28 h-28 sm:w-36 sm:h-36 md:w-44 md:h-44 rounded-3xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-2xl shadow-blue-600/35">
                <Scan className="w-14 h-14 sm:w-18 sm:h-18 md:w-22 md:h-22 stroke-[1.75]" />
              </div>
            </div>

            {/* Title & Headline */}
            <div className="space-y-2.5 max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs sm:text-sm font-extrabold tracking-widest uppercase shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" /> AI Biometric & Uniform
                Verification
              </div>
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-slate-900 tracking-tight leading-none">
                Smart Gate Terminal
              </h1>
              <p className="text-base sm:text-xl md:text-2xl text-slate-600 font-medium">
                Tap anywhere on the screen to begin verification
              </p>
            </div>

            {/* 3 Prominent Feature Cards */}
            <div className="grid grid-cols-3 gap-3 sm:gap-6 w-full max-w-3xl">
              <div className="p-4 sm:p-6 rounded-2xl bg-white/90 backdrop-blur-xl border border-slate-200/90 shadow-sm flex flex-col items-center text-center">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center mb-3">
                  <UserCheck className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600" />
                </div>
                <span className="text-sm sm:text-base font-black text-slate-900">
                  Face Biometrics
                </span>
                <span className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                  Sub-second 3D match
                </span>
              </div>
              <div className="p-4 sm:p-6 rounded-2xl bg-white/90 backdrop-blur-xl border border-slate-200/90 shadow-sm flex flex-col items-center text-center">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mb-3">
                  <Shirt className="w-6 h-6 sm:w-7 sm:h-7 text-indigo-600" />
                </div>
                <span className="text-sm sm:text-base font-black text-slate-900">
                  Prescribed Uniform
                </span>
                <span className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                  YOLO AI dress code
                </span>
              </div>
              <div className="p-4 sm:p-6 rounded-2xl bg-white/90 backdrop-blur-xl border border-slate-200/90 shadow-sm flex flex-col items-center text-center">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-3">
                  <ShieldCheck className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-600" />
                </div>
                <span className="text-sm sm:text-base font-black text-slate-900">
                  Auto Turnstile
                </span>
                <span className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
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
                className="relative group w-full py-6 sm:py-7 px-8 rounded-3xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:via-indigo-500 hover:to-blue-600 active:scale-[0.98] text-white font-black text-xl sm:text-2xl md:text-3xl shadow-[0_20px_50px_rgba(37,99,235,0.4)] transition-all flex items-center justify-center gap-4 cursor-pointer overflow-hidden border-2 border-white/20"
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
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 sm:px-10 py-5 sm:py-7 z-30 pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Identity mark only. The live verdict is announced by the result card
              and the corner colours, so the terminal no longer shouts a status
              string at a student who just wants to see their own face. */}
          <div className="glass-pill pl-2 pr-3.5 py-2 flex items-center gap-2.5 shadow-sm bg-white/60 border-white/40">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-700 via-blue-600 to-indigo-600 flex items-center justify-center text-white font-black text-[9px] shrink-0">
              {schoolBrand.initials}
            </div>
            <span
              className={`inline-flex w-2 h-2 rounded-full ${
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
            <div className="hidden sm:flex glass-pill px-3.5 py-2.5 items-center gap-2 shadow-sm bg-white/60 border-white/40">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-mono text-xs sm:text-sm font-bold text-surface-700 tracking-wider">
                {currentTime}
              </span>
            </div>
          )}

          <div
            className="glass-pill px-3 py-2.5 flex items-center gap-1.5 shadow-sm bg-white/60 border-white/40"
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

          <button
            onClick={() => setShowAdminPanel(!showAdminPanel)}
            className="glass-pill p-3 bg-white/60 border-white/40 hover:bg-white active:bg-surface-100 transition-all cursor-pointer text-surface-500 hover:text-surface-900 shadow-sm"
            aria-label="Open admin panel"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {cameraDown && (
        <div className="absolute bottom-6 left-6 sm:left-10 z-40 glass-pill pl-3 pr-4 py-2.5 flex items-center gap-2 bg-amber-50/95 border-amber-200 shadow-sm">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-[11px] sm:text-xs font-bold text-amber-800 uppercase tracking-wider">
            Camera offline — hardware test mode
          </span>
        </div>
      )}

      {/* ─── Full-Screen Initialization / Boot Sequence ───────────────────────────── */}
      {kioskState === "loading_models" && (
        <div className="absolute inset-0 z-50 bg-[#f8fafc] flex flex-col justify-between p-6 sm:p-10 lg:p-14 select-none overflow-hidden">
          {/* Ambient luminous glow orbs */}
          <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -right-32 w-[30rem] h-[30rem] bg-indigo-400/10 rounded-full blur-3xl pointer-events-none" />

          {/* Micro dot grid texture */}
          <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:28px_28px] opacity-40 pointer-events-none" />

          {/* Institutional Top Header */}
          <div className="relative z-10 flex items-center justify-between w-full max-w-5xl mx-auto pb-4 sm:pb-6 border-b border-slate-200/80">
            <div className="flex items-center gap-3.5 sm:gap-4">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-tr from-blue-700 via-blue-600 to-indigo-600 flex items-center justify-center text-white font-black text-sm sm:text-base shadow-lg shadow-blue-600/25 shrink-0">
                {schoolBrand.initials}
              </div>
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
              <div className="p-3.5 sm:p-4 rounded-2xl bg-white/90 border border-slate-200/90 shadow-sm flex items-center gap-3">
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
              <div className="p-3.5 sm:p-4 rounded-2xl bg-white/90 border border-slate-200/90 shadow-sm flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                  <Shirt className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                    Uniform Vision
                  </p>
                  <p className="text-[11px] text-indigo-600 font-semibold">Loading ONNX</p>
                </div>
              </div>
              <div className="p-3.5 sm:p-4 rounded-2xl bg-white/90 border border-slate-200/90 shadow-sm flex items-center gap-3">
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
        <div className="absolute inset-0 z-50 bg-[#f8fafc] flex flex-col justify-between p-6 sm:p-10 lg:p-14 select-none overflow-hidden">
          {/* Ambient red warning glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-rose-400/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:28px_28px] opacity-40 pointer-events-none" />

          {/* Top Header */}
          <div className="relative z-10 flex items-center justify-between w-full max-w-5xl mx-auto pb-4 sm:pb-6 border-b border-slate-200/80">
            <div className="flex items-center gap-3.5 sm:gap-4">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-tr from-rose-600 to-red-700 flex items-center justify-center text-white font-black text-sm sm:text-base shadow-lg shadow-rose-600/25 shrink-0">
                {schoolBrand.initials}
              </div>
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

      {/* ─── Bottom Status Panel (Centered, High Legibility) ────── */}
      {/* ─── Live scan rail — left edge, vertically centred ───
          Placement is the point here, not decoration. The face occupies the
          centre column and the uniform the lower centre, so a bottom-centre
          banner was covering the exact regions the student wants to see and the
          dress-code model needs to read. The side band is the one strip nobody
          ever stands in, and stacking the steps top-to-bottom matches the order
          they actually resolve in. */}
      {(kioskState === "ready" || kioskState === "scanning") && (
        <div className="absolute left-4 sm:left-8 top-1/2 -translate-y-1/2 z-30 pointer-events-none flex flex-col items-start gap-1.5 w-[13rem] max-w-[42vw]">
          <ScanStepPill label="Face" state={pipeline?.face ?? "working"} />
          <ScanStepPill label="Identity" state={pipeline?.identity ?? "idle"} />
          <ScanStepPill label="Uniform" state={pipeline?.uniform ?? "idle"} />

          {/* Each line hugs its own text — no panel, no border, no shared box.
              The backdrop exists only so the words stay readable on camera. */}
          <p className="mt-1.5 max-w-full rounded-lg bg-white/55 backdrop-blur-md px-2.5 py-1 text-surface-900 font-black tracking-wide text-[13px] leading-snug shadow-sm">
            {pipeline?.title ?? "Step in front of camera"}
          </p>
          <p className="max-w-full rounded-lg bg-white/40 backdrop-blur-sm px-2.5 py-1 text-[11px] text-surface-600 font-medium leading-snug shadow-sm">
            {pipeline?.hint ?? "Face & uniform verification active"}
          </p>
        </div>
      )}

      <div className="absolute bottom-6 left-6 sm:left-10 right-6 sm:right-10 flex items-end justify-center z-30 pointer-events-none">
        <div className="w-full max-w-2xl flex justify-center pointer-events-auto">
          {lastMatch?.matched && lastMatch.person ? (
            <div className="glass-card p-6 sm:p-8 w-full shadow-2xl border-2 border-emerald-500/50 bg-white/95 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0 shadow-sm">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2.5 py-1 rounded-md text-xs font-black tracking-widest bg-emerald-100 text-emerald-800 uppercase">
                      Access Granted
                    </span>
                    <span className="text-sm text-emerald-700 font-mono font-bold">
                      {Math.round((lastMatch.confidence ?? 0.9) * 100)}% Match
                    </span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-black text-surface-900 tracking-tight truncate mt-1">
                    {lastMatch.person.name}
                  </h2>
                  <p className="text-xs sm:text-sm text-surface-500 font-medium">
                    ID: {lastMatch.person.student_id || lastMatch.person.id.slice(0, 8)}
                    {lastMatch.person.department && ` • ${lastMatch.person.department}`}
                  </p>
                </div>
              </div>
              {lastUniform && (
                <div
                  className={`mt-4 pt-3.5 border-t border-surface-200/60 text-sm sm:text-base font-bold flex items-center justify-between ${
                    lastUniform.ok ? "text-emerald-700" : "text-rose-600"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {lastUniform.ok ? (
                      <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                    )}
                    <span className="truncate">
                      Uniform: {lastUniform.ok ? "PASS" : "FAIL"} — {lastUniform.detail}
                    </span>
                  </div>
                  <span className="text-xs font-mono opacity-80 shrink-0 ml-2">
                    {Math.round(lastUniform.confidence * 100)}%
                  </span>
                </div>
              )}
              {isDecisionGateBanner(gateState) && (
                <div
                  className={`mt-3.5 flex items-center justify-between gap-3 text-sm sm:text-base font-black border rounded-2xl px-4 py-3 ${
                    gateState === "OPEN"
                      ? "text-emerald-800 bg-emerald-50 border-emerald-200"
                      : gateState === "AWAITING"
                        ? "text-amber-800 bg-amber-50 border-amber-200"
                        : "text-surface-700 bg-surface-100 border-surface-200"
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
            </div>
          ) : kioskState === "denied" ? (
            <div className="glass-card p-6 sm:p-8 w-full shadow-2xl border-2 border-rose-300 bg-white/95">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                  <XCircle className="w-10 h-10 text-rose-600" />
                </div>
                <div>
                  <p className="text-rose-600 font-black text-2xl sm:text-3xl tracking-tight">
                    ACCESS DENIED
                  </p>
                  <p className="text-surface-700 font-semibold text-sm sm:text-base mt-1">
                    {statusMessage || "Verification failed"}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ─── Last result strip ───────────────────────────── */}
      {/* The verdict card clears after a few seconds, which left the screen with
          no trace of what just happened. This keeps the latest decision visible
          while the student walks on, then clears itself. */}
      {lastDecision && !holdNotice && kioskState !== "granted" && kioskState !== "denied" && (
        <div className="absolute left-6 sm:left-10 bottom-6 z-30 pointer-events-none flex items-center gap-2 rounded-lg bg-white/60 backdrop-blur-md px-3 py-1.5 shadow-sm border border-white/40">
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
          className={`absolute left-1/2 -translate-x-1/2 top-6 z-30 pointer-events-none flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 shadow-lg backdrop-blur-md text-sm font-black ${
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
        <div className="absolute top-24 right-6 sm:right-8 z-40 glass-card p-6 w-[92vw] sm:w-96 shadow-2xl space-y-5 bg-white/95 border border-surface-200">
          <div className="flex items-center justify-between border-b border-surface-100 pb-3">
            <h3 className="font-bold text-surface-900 tracking-tight text-lg">Operator Panel</h3>
            <button
              onClick={() => setShowAdminPanel(false)}
              className="text-surface-400 hover:text-surface-600 p-1 rounded-lg hover:bg-surface-100 transition-colors cursor-pointer"
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
            <div className="flex justify-between">
              <span className="text-surface-500">Pending sync</span>
              <span
                className={`font-mono font-bold ${dbStats.unsyncedCount > 0 ? "text-amber-600" : "text-surface-900"}`}
              >
                {dbStats.unsyncedCount}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Uniform model</span>
              <span
                className={`font-bold ${isYoloModelLoaded() ? "text-green-600" : "text-red-500"}`}
              >
                {isYoloModelLoaded() ? "LOADED" : "MISSING"}
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
                {gateConnected ? `linked · ${gateTransport === "wifi" ? "wifi" : "usb"}` : "no link"}
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
              No camera needed. The GPIO 4 button also opens the gate by itself — tap it to check the
              ESP32 and servo without this screen.
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleManualSync}
              className="btn-primary w-full flex items-center justify-center gap-2"
              disabled={!online}
            >
              <RefreshCw className="w-4 h-4" /> Force Sync
            </button>

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

            {/* Voice toggle */}
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
              onClick={() => window.location.reload()}
              className="w-full text-sm px-5 py-3 rounded-xl font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" /> Reboot Terminal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

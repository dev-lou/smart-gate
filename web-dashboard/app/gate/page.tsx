"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type GateStatus = "idle" | "scanning" | "granted" | "denied";

interface VerifyResponse {
  access: boolean;
  confidence: number;
  message: string;
  status: string;
  error?: string;
  person_name?: string;
  photo_url?: string;
  face_confidence?: number;
  uniform_confidence?: number;
  uniform_detail?: string;
}

/* ── Timing constants ─────────────────────────────────────────────── */
const GRANTED_RETURN_DELAY = 1500;
const DENIED_RETURN_DELAY = 3000;
const SCAN_INTERVAL = 800;
const CONFIRMATION_COUNT = 1;
const BG_PROBE_INTERVAL = 1200;

/**
 * Always go through the Next.js proxy — avoids CORS when the Brain API
 * is on a different origin (e.g. localhost:8088). The proxy reads
 * BRAIN_API_URL from the server-side env (defaults to http://localhost:8088).
 */
const VERIFY_URL = "/api/brain/access-verify";

export default function GatePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* ── Settings ───────────────────────────────────────────────────── */
  const [idleImageUrl, setIdleImageUrl] = useState("");

  /* ── Gate state machine ────────────────────────────────────────── */
  const [status, setStatus] = useState<GateStatus>("idle");
  const [message, setMessage] = useState("");
  const [personName, setPersonName] = useState("");
  const [faceConfidence, setFaceConfidence] = useState(0);
  const [uniformConfidence, setUniformConfidence] = useState(0);
  const [uniformDetail, setUniformDetail] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState("");

  /**
   * showScanner = false  → idle screen (logo), camera hidden in background
   * showScanner = true   → fullscreen camera (scanning / granted / denied)
   */
  const [showScanner, setShowScanner] = useState(false);
  const [direction, setDirection] = useState<"entry" | "exit">("entry");

  const [simulateMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("gate_simulate_mode") === "true";
  });

  /* ── Refs ───────────────────────────────────────────────────────── */
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bgProbeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const idleReturnTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stablePersonIdRef = useRef("");
  const stableConfirmCountRef = useRef(0);
  const cameraRequestedRef = useRef(false);

  /**
   * Ref-based processing lock — avoids the stale-closure problem that occurs
   * when a boolean state value is captured in a useCallback dependency and
   * causes the callback (and the intervals that depend on it) to be recreated
   * on every flip, thrashing the interval timers.
   */
  const isProcessingRef = useRef(false);

  /**
   * Ref mirror of showScanner so verify() can read the latest value without
   * needing showScanner in its dependency array.
   */
  const showScannerRef = useRef(false);
  useEffect(() => {
    showScannerRef.current = showScanner;
  }, [showScanner]);

  /* ── Audio helpers ─────────────────────────────────────────────── */
  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  }, []);

  const playGrantSound = useCallback(() => {
    try {
      const ctx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
      const playTone = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(
          0.01,
          ctx.currentTime + start + dur,
        );
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
      };
      playTone(440, 0, 0.15);
      playTone(660, 0.12, 0.2);
    } catch {
      /* audio not available */
    }
  }, []);

  const playDenySound = useCallback(() => {
    try {
      const ctx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      /* audio not available */
    }
  }, []);

  /* ── Return to idle ────────────────────────────────────────────── */
  const handleReturnToIdle = useCallback(() => {
    isProcessingRef.current = false;
    setStatus("idle");
    setShowScanner(false);
    setMessage("");
    setPersonName("");
    setFaceConfidence(0);
    setUniformConfidence(0);
    setUniformDetail("");
    setError("");
    stablePersonIdRef.current = "";
    stableConfirmCountRef.current = 0;
  }, []);

  const resetIdleReturnTimer = useCallback(
    (delay: number) => {
      if (idleReturnTimerRef.current) clearTimeout(idleReturnTimerRef.current);
      idleReturnTimerRef.current = setTimeout(handleReturnToIdle, delay);
    },
    [handleReturnToIdle],
  );

  /* ── Frame capture ─────────────────────────────────────────────── */
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width < 10 || height < 10) return null;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    try {
      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      if (!dataUrl || dataUrl.length < 100) return null;
      return dataUrl;
    } catch {
      return null;
    }
  }, []);

  /* ── Start camera ──────────────────────────────────────────────── */
  const startCamera = useCallback(async () => {
    if (cameraRequestedRef.current) return;
    cameraRequestedRef.current = true;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera API not supported in this browser");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
          setCameraReady(true);
        } catch {
          setError("Camera stream failed to start");
        }
      }
    } catch (err: any) {
      console.error("Camera error:", err);
      setError(
        err?.message || "Camera unavailable - check browser permissions",
      );
    }
  }, []);

  /* ── Verify ────────────────────────────────────────────────────── */
  /**
   * This callback is intentionally stable — it reads mutable state through
   * refs (isProcessingRef, showScannerRef) rather than state, so it never
   * needs to be in the dependency array of interval effects.
   */
  const verify = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    // Capture whether this call is a silent background probe or an active scan
    const isBackgroundProbe = !showScannerRef.current;

    /* Simulation mode */
    if (simulateMode) {
      await new Promise((r) => setTimeout(r, 800));
      const scenarios = ["granted", "denied_uniform", "unknown_face"];
      const pick = scenarios[Math.floor(Math.random() * scenarios.length)];

      if (pick === "granted") {
        setShowScanner(true);
        setStatus("granted");
        setMessage("Access granted. Welcome!");
        setPersonName("Test Student");
        setFaceConfidence(0.97);
        setUniformConfidence(0.92);
        speak("Welcome Test Student");
        playGrantSound();
        resetIdleReturnTimer(GRANTED_RETURN_DELAY);
      } else if (pick === "denied_uniform") {
        setShowScanner(true);
        setStatus("denied");
        setMessage("Access denied, Test Student. Wear your uniform.");
        setPersonName("Test Student");
        setFaceConfidence(0.95);
        setUniformConfidence(0.31);
        setUniformDetail("Please wear your school uniform");
        speak("Access denied, Test Student. Wear your uniform.");
        playDenySound();
        resetIdleReturnTimer(DENIED_RETURN_DELAY);
      }
      // "unknown_face" → stay on logo, keep probing

      isProcessingRef.current = false;
      return;
    }

    // Capture a frame (up to 3 tries)
    let imageB64: string | null = null;
    for (let i = 0; i < 3; i++) {
      imageB64 = captureFrame();
      if (imageB64) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!imageB64) {
      // Camera not ready yet — silently skip
      isProcessingRef.current = false;
      return;
    }

    try {
      const res = await fetch(VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: imageB64, direction }),
      });

      const data: VerifyResponse = await res.json();

      if (data.error) {
        console.error("Brain API error:", data.error);
        if (!isBackgroundProbe) setError("API Error: " + data.error);
        return;
      }

      /* No face → stay on logo, keep probing silently */
      if (data.status === "no_face") return;

      /* Face detected → transition to scanner view */
      if (!showScannerRef.current) {
        setShowScanner(true);
        setStatus("scanning");
      }

      /* Access granted */
      if (data.access && data.person_name) {
        if (stablePersonIdRef.current === data.person_name) {
          stableConfirmCountRef.current += 1;
        } else {
          stablePersonIdRef.current = data.person_name;
          stableConfirmCountRef.current = 1;
        }

        if (stableConfirmCountRef.current < CONFIRMATION_COUNT) {
          setStatus("scanning");
          return;
        }

        setPersonName(data.person_name);
        setFaceConfidence(data.face_confidence || 0);
        setUniformConfidence(data.uniform_confidence || 0);
        setUniformDetail(data.uniform_detail || "");
        setStatus("granted");
        setMessage(data.message || "Access granted");
        speak(`Welcome ${data.person_name}`);
        playGrantSound();
        resetIdleReturnTimer(GRANTED_RETURN_DELAY);

        /* Denied: uniform */
      } else if (data.status === "denied_uniform") {
        const name = data.person_name?.trim();
        const msg = name
          ? `Access denied, ${name}. Wear your uniform.`
          : "Access denied. Wear your uniform.";
        setStatus("denied");
        setMessage(msg);
        setPersonName(name || "");
        setFaceConfidence(data.face_confidence || 0);
        setUniformConfidence(data.uniform_confidence || 0);
        setUniformDetail(
          data.uniform_detail || "Please wear your school uniform",
        );
        speak(msg);
        playDenySound();
        resetIdleReturnTimer(DENIED_RETURN_DELAY);

        /* Unknown face → keep scanning (scanner is already showing) */
      } else if (data.status === "unknown_face") {
        setStatus("scanning");

        /* Any other denial */
      } else {
        setStatus("denied");
        setMessage(data.message || "Access denied");
        setPersonName(data.person_name || "");
        setFaceConfidence(data.face_confidence || 0);
        setUniformConfidence(data.uniform_confidence || 0);
        speak("Access denied");
        playDenySound();
        resetIdleReturnTimer(DENIED_RETURN_DELAY);
      }
    } catch (err) {
      console.error("Verify error:", err);
      // Only surface the error during active scanning — not silent background probes
      if (!isBackgroundProbe) setError("Connection error");
    } finally {
      isProcessingRef.current = false;
    }
  }, [
    captureFrame,
    speak,
    playGrantSound,
    playDenySound,
    resetIdleReturnTimer,
    simulateMode,
    direction,
  ]);

  /* ── Background probe loop (idle, logo visible) ────────────────── */
  useEffect(() => {
    if (!cameraReady || showScanner) return;

    bgProbeTimerRef.current = setInterval(verify, BG_PROBE_INTERVAL);
    return () => {
      if (bgProbeTimerRef.current) clearInterval(bgProbeTimerRef.current);
    };
    // verify is stable; cameraReady and showScanner correctly gate the loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady, showScanner]);

  /* ── Active scan loop (scanner visible, still identifying) ─────── */
  useEffect(() => {
    if (!showScanner || status !== "scanning") return;

    scanTimerRef.current = setInterval(verify, SCAN_INTERVAL);
    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScanner, status]);

  /* ── Mount: load settings → start camera → request fullscreen ──── */
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const json = await res.json();
          const map = new Map<string, string>(
            (json.settings || []).map((s: { key: string; value: string }) => [
              s.key,
              s.value,
            ]),
          );
          const idleImg = map.get("idle_image_url");
          if (idleImg) setIdleImageUrl(idleImg);
        }
      } catch {
        /* settings unavailable — keep defaults */
      }

      // Start camera after settings load (single call, guarded by ref)
      await startCamera();

      // Request fullscreen
      if (typeof document !== "undefined" && !document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    init();
  }, [startCamera]);

  /* ── Cleanup on unmount ────────────────────────────────────────── */
  useEffect(() => {
    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      if (bgProbeTimerRef.current) clearInterval(bgProbeTimerRef.current);
      if (idleReturnTimerRef.current) clearTimeout(idleReturnTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /* ── Page background ───────────────────────────────────────────── */
  const getBgClass = () => {
    if (status === "granted") return "bg-emerald-500";
    if (status === "denied") return "bg-rose-600";
    return "bg-black";
  };

  /* ══════════════════════════════════════════════════════════════════
     JSX
  ══════════════════════════════════════════════════════════════════ */
  return (
    <main
      className={`fixed inset-0 ${getBgClass()} transition-colors duration-300 overflow-hidden`}
      style={{ touchAction: "manipulation" }}
    >
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Entry/Exit selector for prototype gate mode */}
      <div className="fixed top-4 right-4 z-40 flex rounded-full overflow-hidden border border-white/20 bg-black/50 backdrop-blur-sm text-white text-sm">
        <button
          type="button"
          onClick={() => setDirection("entry")}
          className={`px-4 py-2 ${direction === "entry" ? "bg-emerald-500" : "hover:bg-white/10"}`}
        >
          Entry
        </button>
        <button
          type="button"
          onClick={() => setDirection("exit")}
          className={`px-4 py-2 ${direction === "exit" ? "bg-amber-500" : "hover:bg-white/10"}`}
        >
          Exit
        </button>
      </div>

      {/* Video — always mounted; visible only when scanner is active */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onLoadedData={() => setCameraReady(true)}
        className={
          showScanner
            ? "fixed inset-0 w-full h-full object-cover"
            : "fixed w-0 h-0 opacity-0 pointer-events-none"
        }
        style={{ transform: "scaleX(-1)" }}
      />

      {/* ── Idle screen: logo only, centered ────────────────────── */}
      {!showScanner && (
        <div className="fixed inset-0 flex items-center justify-center bg-black z-10">
          {idleImageUrl ? (
            <img
              src={idleImageUrl}
              alt=""
              className="max-w-[60vw] max-h-[60vh] object-contain animate-fade-in"
              draggable={false}
            />
          ) : (
            <div className="w-48 h-48 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-2xl animate-fade-in">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="white"
                className="w-24 h-24"
              >
                <path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z" />
              </svg>
            </div>
          )}
        </div>
      )}

      {/* ── Scanner: pure camera feed (no chrome) ───────────────── */}
      {/* status === "scanning" → video fills screen, nothing rendered on top */}

      {/* ── Grant overlay ───────────────────────────────────────── */}
      {showScanner && status === "granted" && (
        <div className="fixed inset-0 z-20 flex flex-col items-center justify-center animate-scale-in">
          <div className="absolute top-0 left-0 right-0 h-2 bg-white/40 animate-gate-open" />
          <div className="text-center space-y-4 px-8">
            <div className="text-7xl text-white drop-shadow-lg">&#10003;</div>
            <h2 className="text-4xl font-bold text-white drop-shadow-md">
              {personName}
            </h2>
            <div className="text-lg text-white/80 font-medium">
              Face: {(faceConfidence * 100).toFixed(0)}
              %&nbsp;&nbsp;|&nbsp;&nbsp;Uniform:{" "}
              {(uniformConfidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )}

      {/* ── Deny overlay ────────────────────────────────────────── */}
      {showScanner && status === "denied" && (
        <div className="fixed inset-0 z-20 flex flex-col items-center justify-center animate-deny-shake">
          <div className="absolute top-0 left-0 right-0 h-2 bg-white/40 animate-deny-pulse" />
          <div className="text-center space-y-4 px-8">
            <div className="text-7xl text-white drop-shadow-lg">
              {uniformDetail ? "\uD83D\uDC54" : "\u26D4"}
            </div>
            <h2 className="text-3xl font-bold text-white drop-shadow-md">
              {uniformDetail ? "Uniform Required" : "Access Denied"}
            </h2>
            <p className="text-xl text-white/90">{message}</p>
            {uniformDetail && (
              <p className="text-lg text-white/70">{uniformDetail}</p>
            )}
            <div className="text-base text-white/60 font-medium">
              Face: {(faceConfidence * 100).toFixed(0)}
              %&nbsp;&nbsp;|&nbsp;&nbsp;Uniform:{" "}
              {(uniformConfidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )}

      {/* ── Error toast (only during active scanning) ───────────── */}
      {error && showScanner && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-black/70 text-white px-6 py-3 rounded-full backdrop-blur-sm text-sm">
          {error}
        </div>
      )}

      {/* ── Animations ──────────────────────────────────────────── */}
      <style jsx global>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes scale-in {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes gate-open {
          from {
            transform: scaleX(0);
            transform-origin: left;
          }
          to {
            transform: scaleX(1);
            transform-origin: left;
          }
        }
        @keyframes deny-shake {
          0%,
          100% {
            transform: translateX(0);
          }
          15% {
            transform: translateX(-6px);
          }
          30% {
            transform: translateX(6px);
          }
          45% {
            transform: translateX(-4px);
          }
          60% {
            transform: translateX(4px);
          }
          75% {
            transform: translateX(-2px);
          }
          90% {
            transform: translateX(2px);
          }
        }
        @keyframes deny-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.3;
          }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out;
        }
        .animate-scale-in {
          animation: scale-in 0.3s ease-out;
        }
        .animate-gate-open {
          animation: gate-open 0.6s ease-out forwards;
        }
        .animate-deny-shake {
          animation:
            deny-shake 0.5s ease-out,
            scale-in 0.3s ease-out;
        }
        .animate-deny-pulse {
          animation: deny-pulse 0.8s ease-in-out 3;
        }
      `}</style>
    </main>
  );
}

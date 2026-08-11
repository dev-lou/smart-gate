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
  type UniformCheckResult,
} from "@/lib/uniform";
import {
  connectToArduino,
  tryAutoConnect,
  disconnectArduino,
  openGate,
  closeGate,
  onArduinoEvent,
  isSerialSupported,
  type ArduinoEvent,
} from "@/lib/arduino";
import {
  getEnrolledFaces,
  addLog,
  getActiveStudents,
  getStudent,
  storeStudents,
  getAllSettings,
  getDatabaseStats,
  type StoredStudent,
} from "@/lib/db";
import { fullSync, initSupabase } from "@/lib/supabase";
import { ShieldCheck, Wifi, WifiOff, Plug, RefreshCw, AlertCircle, XCircle, Link, CheckCircle2 } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────

type KioskState =
  "init" | "loading_models" | "ready" | "scanning" | "granted" | "denied" | "error" | "offline";

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
  const [lastMatch, setLastMatch] = useState<MatchResult | null>(null);
  const [lastUniform, setLastUniform] = useState<UniformCheckResult | null>(null);
  const [fps, setFps] = useState(0);
  const [arduinoConnected, setArduinoConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>("");
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [dbStats, setDbStats] = useState({ studentCount: 0, logCount: 0, unsyncedCount: 0 });
  const [online, setOnline] = useState(true);

  // 🔴 FIX BUG #1: Use refs for state the main loop needs to read
  // React state closures would be stale inside requestAnimationFrame callbacks
  const kioskStateRef = useRef<KioskState>("init");
  const arduinoConnectedRef = useRef(false);
  const onlineRef = useRef(true);

  // Keep refs in sync with React state
  useEffect(() => {
    kioskStateRef.current = kioskState;
  }, [kioskState]);
  useEffect(() => {
    arduinoConnectedRef.current = arduinoConnected;
  }, [arduinoConnected]);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  // Tracking refs for performance
  const enrolledRef = useRef<EnrolledFace[]>([]);
  const settingsRef = useRef<{ uniformEnabled: boolean; matchThreshold: number }>({
    uniformEnabled: true,
    matchThreshold: 0.6,
  });
  const settingsLoadedRef = useRef(false);
  const fpsRef = useRef(0);
  const lastFpsTime = useRef(Date.now());
  const scanCooldown = useRef(false);
  const lastMatchRef = useRef<MatchResult | null>(null);
  const processingRef = useRef(false); // Prevents concurrent face processing
  const photoProcessingRef = useRef(false); // 🔴 FIX BUG #2: Mutex for processStudentPhotos
  const arduinoCleanupRef = useRef<(() => void) | null>(null); // Fix #3: Arduino listener cleanup

  // ─── Initialization ─────────────────────────────────────

  useEffect(() => {
    initKiosk();
    return () => {
      cleanup();
      // Unsubscribe from Arduino events to prevent listener leak
      arduinoCleanupRef.current?.();
      arduinoCleanupRef.current = null;
    };
  }, []);

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

      // 2. Start camera
      setStatusMessage("Starting camera...");
      const cameraOk = await startCamera();
      if (!cameraOk) {
        setKioskState("error");
        setStatusMessage("Failed to access camera. Please allow camera permissions.");
        return;
      }

      // 3. Initialize Supabase
      initSupabase();

      // 4. Try auto-connect Arduino
      setStatusMessage("Connecting to Arduino...");
      if (isSerialSupported()) {
        const autoConnected = await tryAutoConnect().catch(() => false);
        setArduinoConnected(autoConnected);
      }

      // 5. Load enrolled faces from IndexedDB
      await refreshEnrolledFaces();

      // 6. Try background sync
      syncInBackground();

      // 7. Start main loop
      setKioskState("ready");
      setStatusMessage("Ready");
      startMainLoop();

      // 8. Listen for Arduino events
      // 🔴 Fix #3: Store unsubscribe in a ref (not returned — initKiosk is async)
      arduinoCleanupRef.current = onArduinoEvent(handleArduinoEvent);

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "environment",
          frameRate: { ideal: 30 },
        },
      });

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

      // Sync canvas sizes
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      overlayCanvas.width = video.videoWidth;
      overlayCanvas.height = video.videoHeight;

      frameCount++;

      // Process every 3rd frame for performance
      // 🔴 FIX BUG #3: Check scan cooldown AND don't re-enter if already processing
      if (
        frameCount % 3 === 0 &&
        kioskStateRef.current !== "granted" &&
        !scanCooldown.current &&
        !processingRef.current
      ) {
        try {
          // 1. Detect faces
          const faces = detectFaces(video, canvas);

          if (faces.length > 0) {
            processingRef.current = true;

            // 2. For the largest face, try recognition
            const largestFace = faces.reduce((a, b) =>
              a.bbox[2] * a.bbox[3] > b.bbox[2] * b.bbox[3] ? a : b,
            );

            await processFace(largestFace, video, canvas);
            processingRef.current = false;
          }

          // Draw overlays
          drawOverlays(faces, overlayCanvas);

          // FPS counter
          fpsRef.current++;
          const now = Date.now();
          if (now - lastFpsTime.current >= 1000) {
            setFps(fpsRef.current);
            fpsRef.current = 0;
            lastFpsTime.current = now;
          }
        } catch (err) {
          console.error("Process error:", err);
          processingRef.current = false;
        }
      }

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
    const match = matchFace(embedding, enrolledRef.current);
    lastMatchRef.current = match;
    setLastMatch(match);

    // Check uniform if matched
    let uniformCheck: UniformCheckResult | null = null;
    if (match.matched && match.person && settingsRef.current.uniformEnabled) {
      uniformCheck = await checkUniform(video, face.bbox, match.person.uniform_type, canvas);
      setLastUniform(uniformCheck);
    }

    // Determine access
    const accessGranted =
      match.matched && (!settingsRef.current.uniformEnabled || (uniformCheck?.ok ?? true));

    if (accessGranted) {
      // Grant access
      setKioskState("granted");
      setStatusMessage(`Welcome, ${match.person!.name}!`);

      // Open gate via Arduino
      // 🔴 FIX BUG #1: Use ref for arduino state check
      if (arduinoConnectedRef.current) {
        await openGate().catch((err) => console.warn("[Kiosk] Gate open failed:", err));
      }

      // Log access
      await addLog({
        person_id: match.person!.id,
        person_name: match.person!.name,
        person_type: "student",
        direction: "entry",
        method: "face",
        success: true,
        confidence: match.confidence,
        uniform_ok: uniformCheck?.ok ?? null,
        failure_reason: null,
        device_timestamp: new Date().toISOString(),
      }).catch((err) => console.warn("[Kiosk] Log write failed:", err));

      // Update stats
      refreshStats();

      // Cooldown before next scan
      scanCooldown.current = true;
      setTimeout(() => {
        setKioskState("ready");
        setStatusMessage("Ready");
        setLastMatch(null);
        setLastUniform(null);
        scanCooldown.current = false;

        // Close gate after delay
        if (arduinoConnectedRef.current) {
          closeGate().catch((err) => console.warn("[Kiosk] Gate close failed:", err));
        }
      }, 5000);
    } else if (match.matched && uniformCheck && !uniformCheck.ok) {
      // Denied due to uniform
      setKioskState("denied");
      const name = match.person!.name;
      setStatusMessage(`${name}: ${uniformCheck.detail}`);

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

      refreshStats();

      // Reset after a moment
      setTimeout(() => {
        if (kioskStateRef.current === "denied") {
          setKioskState("ready");
          setStatusMessage("Ready");
          setLastMatch(null);
          setLastUniform(null);
        }
      }, 4000);
    } else {
      // Unknown face - just show it was detected
      setKioskState("ready");
      setStatusMessage("Scanning...");
    }
  }

  // ─── Drawing ────────────────────────────────────────────

  function drawOverlays(faces: FaceResult[], overlayCanvas: HTMLCanvasElement) {
    const ctx = overlayCanvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    for (const face of faces) {
      const [x, y, w, h] = face.bbox;
      const cx = x * overlayCanvas.width;
      const cy = y * overlayCanvas.height;
      const cw = w * overlayCanvas.width;
      const ch = h * overlayCanvas.height;

      // Match this face to see if it's recognized
      const isMatch = lastMatchRef.current?.matched ?? false;
      const color = isMatch ? "34, 197, 94" : "96, 165, 250";

      // Draw bounding box
      ctx.strokeStyle = `rgba(${color}, 0.8)`;
      ctx.lineWidth = 3;
      ctx.strokeRect(cx, cy, cw, ch);

      // Draw corner markers (scan effect)
      const cornerLen = 25;
      ctx.strokeStyle = `rgba(${color}, 0.9)`;
      ctx.lineWidth = 4;

      // Top-left
      ctx.beginPath();
      ctx.moveTo(cx, cy + cornerLen);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + cornerLen, cy);
      ctx.stroke();

      // Top-right
      ctx.beginPath();
      ctx.moveTo(cx + cw - cornerLen, cy);
      ctx.lineTo(cx + cw, cy);
      ctx.lineTo(cx + cw, cy + cornerLen);
      ctx.stroke();

      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(cx, cy + ch - cornerLen);
      ctx.lineTo(cx, cy + ch);
      ctx.lineTo(cx + cornerLen, cy + ch);
      ctx.stroke();

      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(cx + cw - cornerLen, cy + ch);
      ctx.lineTo(cx + cw, cy + ch);
      ctx.lineTo(cx + cw, cy + ch - cornerLen);
      ctx.stroke();

      // Draw label
      if (isMatch && lastMatchRef.current?.person) {
        const label = lastMatchRef.current.person.name;
        ctx.fillStyle = `rgba(34, 197, 94, 0.85)`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(cx, cy - 32, textWidth + 16, 32);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px Inter, sans-serif";
        ctx.fillText(label, cx + 8, cy - 10);

        // Confidence
        const confText = `${(lastMatchRef.current.confidence * 100).toFixed(0)}%`;
        ctx.fillStyle = "rgba(34, 197, 94, 0.7)";
        ctx.font = "12px JetBrains Mono, monospace";
        ctx.fillText(confText, cx + cw - ctx.measureText(confText).width - 8, cy + ch + 20);
      }

      // Scanning indicator
      if (kioskState === "scanning") {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(96, 165, 250, 0.4)";
        ctx.lineWidth = 1;
        const scanY = cy + ((Date.now() % 2000) / 2000) * ch;
        ctx.moveTo(cx, scanY);
        ctx.lineTo(cx + cw, scanY);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + cw / 2, scanY, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(96, 165, 250, 0.6)";
        ctx.fill();
      }
    }
  }

  // ─── Arduino Handler ────────────────────────────────────

  function handleArduinoEvent(event: ArduinoEvent) {
    if (event.type === "button_press") {
      // Guard pressed the physical override button
      openGate().catch(() => {});
      setKioskState("granted");
      setStatusMessage("Manual override — gate opened");

      addLog({
        person_id: null,
        person_name: "Manual Override",
        person_type: "manual",
        direction: "entry",
        method: "manual",
        success: true,
        confidence: null,
        uniform_ok: null,
        failure_reason: null,
        device_timestamp: new Date().toISOString(),
      }).catch(() => {});

      setTimeout(() => {
        setKioskState("ready");
        setStatusMessage("Ready");
        closeGate().catch(() => {});
      }, 5000);
    } else if (event.type === "connected") {
      setArduinoConnected(true);
    } else if (event.type === "disconnected") {
      setArduinoConnected(false);
      // 🔴 FIX BUG #3: Log disconnection
      console.warn("[Kiosk] Arduino disconnected, auto-reconnect will attempt...");
    } else if (event.type === "reconnecting") {
      setStatusMessage("Reconnecting to Arduino...");
    } else if (event.type === "reconnect_failed") {
      setStatusMessage("Arduino disconnected — tap to reconnect");
    }
  }

  // ─── Sync ───────────────────────────────────────────────

  async function syncInBackground() {
    try {
      const status = await fullSync();
      if (status.studentsDownloaded > 0) {
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
    if (status.studentsDownloaded > 0) {
      await refreshEnrolledFaces();
    }
    setSyncStatus(
      status.error
        ? `Sync error: ${status.error}`
        : `Synced: ${status.studentsDownloaded} students, ${status.logsUploaded} logs`,
    );
    refreshStats();
    setShowSyncPanel(false);
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
      return;
    }
    await processStudentPhotos();
    const faces = await getEnrolledFaces();
    enrolledRef.current = faces;
    setEnrolledCount(faces.length);
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
    disconnectArduino().catch(() => {});
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

      settingsLoadedRef.current = true;
      console.log("[Kiosk] Settings loaded:", settingsRef.current);
    } catch (err) {
      console.warn("[Kiosk] Failed to load settings:", err);
    }
  }

  // ─── Connect Arduino Button ─────────────────────────────

  async function handleConnectArduino() {
    try {
      await connectToArduino();
      setArduinoConnected(true);
    } catch (err) {
      console.error("Arduino connection failed:", err);
    }
  }

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="relative w-screen h-screen bg-surface-50 overflow-hidden">
      {/* Hidden canvases for processing */}
      <canvas ref={canvasRef} className="hidden" />
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* Camera Feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Premium White Gradients for Readability */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-white/90 to-transparent z-20" />
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-white/90 to-transparent z-20" />

      {/* Scan Frame - hidden when models are loading */}
      {kioskState !== "init" && kioskState !== "loading_models" && (
        <div
          className={`scan-frame z-10 ${
            kioskState === "granted"
              ? "scan-frame-active"
              : kioskState === "denied"
                ? "scan-frame-deny"
                : kioskState === "scanning"
                  ? "animate-pulse"
                  : ""
          }`}
        >
          <div className="scan-corner scan-corner-tl" />
          <div className="scan-corner scan-corner-tr" />
          <div className="scan-corner scan-corner-bl" />
          <div className="scan-corner scan-corner-br" />
        </div>
      )}

      {/* ─── Top Bar ─────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-8 py-6 z-30">
        <div className="flex items-center gap-4">
          {/* Status indicator */}
          <div className="glass-card-light px-4 py-2 flex items-center gap-3">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                kioskState === "ready" || kioskState === "granted"
                  ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                  : kioskState === "error"
                    ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                    : "bg-yellow-500 animate-pulse"
              }`}
            />
            <span className="text-surface-700 font-semibold text-sm tracking-wide">
              {kioskState === "granted"
                ? statusMessage
                : kioskState === "denied"
                  ? statusMessage
                  : kioskState === "loading_models"
                    ? "System Initializing..."
                    : kioskState === "scanning"
                      ? "Analyzing..."
                      : kioskState === "error"
                        ? "System Fault"
                        : "Smart Gate Active"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Online/Offline */}
          <div className="glass-card-light px-4 py-2 flex items-center gap-2">
            {online ? (
              <Wifi className="w-4 h-4 text-green-600" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-500" />
            )}
            <span className={`text-xs font-semibold ${online ? "text-green-700" : "text-red-600"}`}>
              {online ? "Connected" : "Offline"}
            </span>
          </div>

          {/* FPS */}
          <div className="glass-card-light px-4 py-2">
            <span className="text-surface-400 text-xs font-mono font-semibold">{fps} FPS</span>
          </div>

          {/* Arduino */}
          <div className="glass-card-light px-4 py-2">
            {arduinoConnected ? (
              <span className="text-xs text-green-700 font-semibold flex items-center gap-2">
                <Plug className="w-4 h-4" /> Hardware Active
              </span>
            ) : (
              <button
                onClick={handleConnectArduino}
                className="text-xs text-surface-500 hover:text-primary-600 font-semibold flex items-center gap-2 transition-colors"
              >
                <Link className="w-4 h-4" /> Connect Hardware
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Center Status ───────────────────────────── */}
      {kioskState === "loading_models" && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-white/60 backdrop-blur-md">
          <div className="flex flex-col items-center gap-6 glass-card p-10">
            <RefreshCw className="w-12 h-12 text-primary-600 animate-spin" />
            <div className="text-center">
              <p className="text-surface-900 text-xl font-semibold mb-1">{statusMessage}</p>
              <p className="text-surface-500 text-sm">
                Initializing enterprise AI models. Please wait.
              </p>
            </div>
          </div>
        </div>
      )}

      {kioskState === "error" && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-white/80 backdrop-blur-md">
          <div className="text-center space-y-6 max-w-md glass-card p-10">
            <div className="w-20 h-20 mx-auto rounded-full bg-red-50 flex items-center justify-center">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            <div>
              <p className="text-surface-900 text-xl font-bold mb-2">System Fault</p>
              <p className="text-surface-600 text-sm">{statusMessage}</p>
            </div>
            <button onClick={() => window.location.reload()} className="btn-primary w-full">
              Reboot Terminal
            </button>
          </div>
        </div>
      )}

      {/* ─── Grant/Deny Flash ────────────────────────── */}
      {kioskState === "granted" && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className="absolute inset-0 bg-green-500/10 animate-pulse" />
        </div>
      )}

      {kioskState === "denied" && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className="absolute inset-0 bg-red-500/10 animate-pulse" />
        </div>
      )}

      {/* ─── Bottom Status Panel ────────────────────── */}
      <div className="absolute bottom-8 left-8 right-8 flex items-end justify-between z-30">
        {/* Left: Match Info */}
        <div className="space-y-4">
          {lastMatch?.matched && lastMatch.person ? (
            <div className="glass-card p-6 min-w-80 shadow-lg">
              <div className="flex items-center gap-4">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
                <div>
                  <p className="text-surface-900 font-bold text-xl tracking-tight">
                    {lastMatch.person.name}
                  </p>
                  <p className="text-surface-500 font-medium text-sm mt-0.5">
                    {lastMatch.person.department} • {lastMatch.person.student_id}
                  </p>
                </div>
                <div className="ml-auto text-right bg-green-50 px-3 py-1.5 rounded-lg">
                  <p className="text-green-700 font-mono font-bold text-lg">
                    {(lastMatch.confidence * 100).toFixed(0)}%
                  </p>
                  <p className="text-green-600/70 text-xs font-semibold uppercase tracking-wider">Match</p>
                </div>
              </div>
              {lastUniform && (
                <div
                  className={`mt-4 pt-3 border-t border-surface-200/60 text-sm font-medium flex items-center gap-2 ${
                    lastUniform.ok ? "text-green-700" : "text-red-600"
                  }`}
                >
                  {lastUniform.ok ? <ShieldCheck className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  <span>
                    Uniform Validation: {lastUniform.ok ? "PASS" : "FAIL"} — {lastUniform.detail}
                  </span>
                </div>
              )}
            </div>
          ) : kioskState === "ready" ? (
            <div className="glass-card px-6 py-4 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <p className="text-surface-500 font-medium tracking-wide">Awaiting Subject...</p>
            </div>
          ) : null}
        </div>

        {/* Right: Quick controls */}
        <div className="flex items-center gap-4">
          {/* Enrolled count */}
          <div className="glass-card px-6 py-4 text-center">
            <p className="text-surface-900 font-bold text-2xl tracking-tight">{enrolledCount}</p>
            <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mt-1">Profiles</p>
          </div>

          {/* Sync button */}
          <button
            onClick={() => setShowSyncPanel(!showSyncPanel)}
            className="glass-card p-5 hover:bg-surface-50 active:bg-surface-100 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-6 h-6 text-surface-600" />
          </button>
        </div>
      </div>

      {/* ─── Sync Panel ──────────────────────────────── */}
      {showSyncPanel && (
        <div className="absolute bottom-32 right-8 z-40 glass-card p-6 min-w-80 shadow-xl space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-surface-900 tracking-tight text-lg">System Synchronization</h3>
            <button onClick={() => setShowSyncPanel(false)} className="text-surface-400 hover:text-surface-600">
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3 text-sm font-medium bg-surface-50/50 p-4 rounded-xl border border-surface-100">
            <div className="flex justify-between">
              <span className="text-surface-500">Active Profiles</span>
              <span className="text-surface-900 font-mono">{dbStats.studentCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Activity Logs</span>
              <span className="text-surface-900 font-mono">{dbStats.logCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-500">Pending Sync</span>
              <span className="text-amber-600 font-mono">{dbStats.unsyncedCount}</span>
            </div>
          </div>

          {syncStatus && (
            <div className="bg-primary-50 text-primary-700 p-3 rounded-lg text-sm font-medium border border-primary-100">
              {syncStatus}
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={handleManualSync}
              className="btn-primary w-full flex items-center justify-center gap-2"
              disabled={!online}
            >
              <RefreshCw className="w-4 h-4" /> Force Sync
            </button>

            <button
              onClick={handleConnectArduino}
              className={`w-full text-sm px-5 py-3 rounded-xl font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
                arduinoConnected
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-surface-100 hover:bg-surface-200 text-surface-700 border border-surface-200"
              }`}
            >
              {arduinoConnected ? (
                <><CheckCircle2 className="w-4 h-4" /> Hardware Linked</>
              ) : (
                <><Plug className="w-4 h-4" /> Bind Hardware</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


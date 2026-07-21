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

// ─── Types ──────────────────────────────────────────────────

type KioskState =
  | "init"
  | "loading_models"
  | "ready"
  | "scanning"
  | "granted"
  | "denied"
  | "error"
  | "offline";

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
  useEffect(() => { kioskStateRef.current = kioskState; }, [kioskState]);
  useEffect(() => { arduinoConnectedRef.current = arduinoConnected; }, [arduinoConnected]);
  useEffect(() => { onlineRef.current = online; }, [online]);

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
              a.bbox[2] * a.bbox[3] > b.bbox[2] * b.bbox[3] ? a : b
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
      uniformCheck = await checkUniform(
        video,
        face.bbox,
        match.person.uniform_type,
        canvas
      );
      setLastUniform(uniformCheck);
    }

    // Determine access
    const accessGranted = match.matched && (!settingsRef.current.uniformEnabled || (uniformCheck?.ok ?? true));

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
          : ""
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
        if (!ctx) { resolve(null); return; }
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
        : `Synced: ${status.studentsDownloaded} students, ${status.logsUploaded} logs`
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
      const needsProcessing = students.filter(
        (s) => s.embeddings.length === 0 && s.photo_url
      );
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
              a.bbox[2] * a.bbox[3] > b.bbox[2] * b.bbox[3] ? a : b
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
    <div className="relative w-screen h-screen bg-surface-950 overflow-hidden">
      {/* Hidden canvases for processing */}
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />

      {/* Camera Feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Gradient overlays for readability */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-surface-950/80 to-transparent z-20" />
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-surface-950/80 to-transparent z-20" />

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
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-4 z-30">
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div
            className={`w-3 h-3 rounded-full ${
              kioskState === "ready" || kioskState === "granted"
                ? "bg-green-500"
                : kioskState === "error"
                ? "bg-red-500"
                : "bg-yellow-500 animate-pulse"
            }`}
          />
          <span className="text-white/80 font-medium text-sm">
            {kioskState === "granted"
              ? statusMessage
              : kioskState === "denied"
              ? statusMessage
              : kioskState === "loading_models"
              ? "Loading..."
              : kioskState === "scanning"
              ? "Detecting..."
              : kioskState === "error"
              ? "Error"
              : "Smart Gate"}
          </span>
        </div>

        <div className="flex items-center gap-5">
          {/* Online/Offline */}
          <div className={`flex items-center gap-1.5 ${online ? "text-green-400" : "text-red-400"}`}>
            <div className={`w-2 h-2 rounded-full ${online ? "bg-green-400" : "bg-red-400"}`} />
            <span className="text-xs font-mono">{online ? "Online" : "Offline"}</span>
          </div>

          {/* FPS */}
          <span className="text-white/40 text-xs font-mono">{fps} fps</span>

          {/* Arduino */}
          {arduinoConnected ? (
            <span className="text-xs text-green-400 flex items-center gap-1">🔌 Arduino</span>
          ) : (
            <button
              onClick={handleConnectArduino}
              className="text-xs text-surface-400 hover:text-white transition-colors"
            >
              🔗 Connect Arduino
            </button>
          )}

          {/* Spacer for alignment */}
          <div className="w-8" />
        </div>
      </div>

      {/* ─── Center Status ───────────────────────────── */}
      {kioskState === "loading_models" && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-surface-950/60">
          <div className="flex flex-col items-center gap-5">
            <div className="w-16 h-16 border-[3px] border-primary-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-white/80 text-lg font-medium">{statusMessage}</p>
            <p className="text-white/40 text-sm">Loading AI models (first time may take a moment)</p>
          </div>
        </div>
      )}

      {kioskState === "error" && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-surface-950/80">
          <div className="text-center space-y-4 max-w-md">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/20 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <p className="text-white/80 text-lg font-medium">System Error</p>
            <p className="text-white/50 text-sm">{statusMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary mt-4"
            >
              Restart Kiosk
            </button>
          </div>
        </div>
      )}

      {/* ─── Grant/Deny Flash ────────────────────────── */}
      {kioskState === "granted" && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className="absolute inset-0 bg-green-500/5 animate-pulse" />
        </div>
      )}

      {kioskState === "denied" && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div className="absolute inset-0 bg-red-500/5 animate-pulse" />
        </div>
      )}

      {/* ─── Bottom Status Panel ────────────────────── */}
      <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between z-30">
        {/* Left: Match Info */}
        <div className="space-y-3">
          {lastMatch?.matched && lastMatch.person ? (
            <div className="glass-card px-5 py-4 min-w-64">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <div>
                  <p className="text-white font-bold text-lg">{lastMatch.person.name}</p>
                  <p className="text-white/50 text-xs">
                    {lastMatch.person.department} · {lastMatch.person.student_id}
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-green-400 font-mono text-sm">{(lastMatch.confidence * 100).toFixed(0)}%</p>
                  <p className="text-white/30 text-xs">match</p>
                </div>
              </div>
              {lastUniform && (
                <div className={`mt-2 pt-2 border-t border-white/10 text-xs ${
                  lastUniform.ok ? "text-green-400" : "text-red-400"
                }`}>
                  Uniform: {lastUniform.ok ? "✓ PASS" : "✗ FAIL"} · {lastUniform.detail}
                </div>
              )}
            </div>
          ) : kioskState === "ready" ? (
            <div className="glass-card px-5 py-4">
              <p className="text-white/50 text-sm">Waiting for face...</p>
            </div>
          ) : null}
        </div>

        {/* Right: Quick controls */}
        <div className="flex items-center gap-3">
          {/* Enrolled count */}
          <div className="glass-card px-4 py-3 text-center">
            <p className="text-white font-bold text-lg">{enrolledCount}</p>
            <p className="text-white/40 text-xs">enrolled</p>
          </div>

          {/* Sync button */}
          <button
            onClick={() => setShowSyncPanel(!showSyncPanel)}
            className="glass-card px-4 py-3 hover:bg-white/5 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/60 mx-auto">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
        </div>
      </div>

      {/* ─── Sync Panel ──────────────────────────────── */}
      {showSyncPanel && (
        <div className="absolute top-20 right-6 z-40 glass-card p-5 min-w-72 space-y-4">
          <h3 className="font-semibold text-white">Sync Settings</h3>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-white/50">Students</span>
              <span className="text-white font-mono">{dbStats.studentCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Logs stored</span>
              <span className="text-white font-mono">{dbStats.logCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Unsynced logs</span>
              <span className="text-yellow-400 font-mono">{dbStats.unsyncedCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Network</span>
              <span className={online ? "text-green-400" : "text-red-400"}>{online ? "Online" : "Offline"}</span>
            </div>
          </div>

          {syncStatus && (
            <p className="text-xs text-white/40">{syncStatus}</p>
          )}

          <button
            onClick={handleManualSync}
            className="btn-primary w-full text-sm disabled:opacity-50"
            disabled={!online}
          >
            Sync Now
          </button>

          <button
            onClick={handleConnectArduino}
            className={`w-full text-sm px-4 py-2.5 rounded-xl font-semibold transition-all duration-200 ${
              arduinoConnected
                ? "bg-green-600/20 text-green-400 border border-green-500/30"
                : "bg-surface-700 hover:bg-surface-600 text-white/70"
            }`}
          >
            {arduinoConnected ? "✅ Arduino Connected" : "🔌 Connect Arduino"}
          </button>

          <button
            onClick={() => setShowSyncPanel(false)}
            className="text-xs text-white/30 hover:text-white/50 transition-colors w-full"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

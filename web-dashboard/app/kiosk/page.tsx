"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const STATUS_STYLE: Record<string, string> = {
  granted: "bg-emerald-500/20 border-emerald-400/40 text-emerald-200",
  denied_uniform: "bg-amber-500/20 border-amber-400/40 text-amber-100",
  unknown_face: "bg-rose-500/20 border-rose-400/40 text-rose-100",
  no_face: "bg-slate-500/20 border-slate-300/30 text-slate-100",
  error: "bg-rose-500/20 border-rose-400/40 text-rose-100",
  idle: "bg-sky-500/20 border-sky-400/40 text-sky-100",
};

export default function KioskPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("Ready. Tap Start Camera.");
  const [personName, setPersonName] = useState<string>("");
  const [brainUrlInput, setBrainUrlInput] = useState("");
  const [simulateMode, setSimulateMode] = useState(false);
  const [simScenario, setSimScenario] = useState("granted");
  const [direction, setDirection] = useState<"entry" | "exit">("entry");
  const [qrTokenInput, setQrTokenInput] = useState("");

  const brainUrl = useMemo(() => {
    if (brainUrlInput.trim()) return brainUrlInput.trim().replace(/\/$/, "");
    const fromEnv = process.env.NEXT_PUBLIC_BRAIN_API_URL || "";
    return fromEnv.trim().replace(/\/$/, "");
  }, [brainUrlInput]);

  const captureFrameB64 = (): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (
      !video ||
      !canvas ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return null;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const analyze = async () => {
    if (!brainUrl) {
      setStatus("error");
      setMessage("Set Brain API URL first.");
      return;
    }

    const image_b64 = captureFrameB64();
    if (!image_b64) {
      setStatus("error");
      setMessage("No camera frame available yet.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${brainUrl}/access-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64,
          direction,
          simulate: simulateMode,
          scenario: simScenario,
        }),
      });
      const data = await res.json();
      setStatus(data.status || "idle");
      setMessage(data.message || "No message.");
      setPersonName(data.person_name || "");
    } catch (err: any) {
      console.error(err);
      setStatus("error");
      setMessage(
        `API Error: ${err.message || "Cannot reach server. Check console."}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyGuestQr = async () => {
    if (!brainUrl || !qrTokenInput.trim()) {
      setStatus("error");
      setMessage("Set Brain API URL and QR token first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${brainUrl}/qr-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qr_token: qrTokenInput.trim(),
          direction,
          guard_name: "Kiosk Guard",
        }),
      });
      const data = await res.json();
      const granted = data.access === true;
      setStatus(granted ? "granted" : "denied_uniform");
      setMessage(
        data.message || (granted ? "Guest QR accepted" : "Guest QR denied"),
      );
      setPersonName(data.person_name || "Guest Visitor");
      if (granted) setQrTokenInput("");
    } catch (err: any) {
      setStatus("error");
      setMessage(`QR Error: ${err.message || "Cannot reach server."}`);
    } finally {
      setBusy(false);
    }
  };


  const detectUniform = async () => {
    if (!brainUrl) {
      setStatus("error");
      setMessage("Set Brain API URL first.");
      return;
    }

    const image_b64 = captureFrameB64();
    if (!image_b64) {
      setStatus("error");
      setMessage("No camera frame available yet.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`${brainUrl}/detect-uniform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64 }),
      });
      const data = await res.json();
      if (data.uniform_ok) {
        setStatus("granted");
        setMessage(
          `Uniform Check: OK (Confidence: ${(data.uniform_confidence * 100).toFixed(1)}%) - ${data.uniform_detail}`,
        );
      } else {
        setStatus("denied_uniform");
        setMessage(
          `Uniform Check: FAILED (Confidence: ${(data.uniform_confidence * 100).toFixed(1)}%) - ${data.uniform_detail}`,
        );
      }
      setPersonName("");
    } catch (err: any) {
      console.error(err);
      setStatus("error");
      setMessage(`API Error: ${err.message || "Cannot reach server."}`);
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    if (!brainUrl) {
      setStatus("error");
      setMessage("Set Brain API URL first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${brainUrl}/sync-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.ok) {
        const c = data.counts || { students: 0, cards: 0, settings: 0 };
        setStatus("idle");
        setMessage(
          `Sync complete: students ${c.students}, cards ${c.cards}, settings ${c.settings}.`,
        );
      } else {
        setStatus("error");
        setMessage("Sync failed. Check cloud API reachability and URL.");
      }
    } catch (err: any) {
      console.error(err);
      setStatus("error");
      setMessage(`Sync error: ${err.message || "request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (running) {
      timer = setInterval(() => {
        if (!busy) analyze();
      }, 1700);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [running, busy, brainUrl]);

  const startCamera = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("error");
      setMessage("Camera not supported in this browser.");
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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>((resolve) => {
          if (!videoRef.current) return resolve();
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            resolve();
          };
          setTimeout(resolve, 2000);
        });
      }
      setMessage("Camera ready. Tap Start Scan.");
      setRunning(true);
    } catch (e: any) {
      setStatus("error");
      setMessage(e?.message || "Camera permission denied or not available.");
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
    setStatus("idle");
    setMessage("Camera stopped.");
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white p-4">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-center">
          Smart Gate Kiosk
        </h1>

        <div className="bg-slate-900/80 rounded-2xl p-3 border border-slate-700">
          <label className="text-xs text-slate-300">Brain API URL</label>
          <input
            className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm"
            placeholder="https://your-tunnel-url"
            value={brainUrlInput}
            onChange={(e) => setBrainUrlInput(e.target.value)}
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Running Live AI Mode
          </p>
        </div>

        <div className="relative bg-black rounded-2xl overflow-hidden border border-slate-700">
          <video
            ref={videoRef}
            className="w-full aspect-[3/4] object-cover"
            playsInline
            muted
            autoPlay
          />
          <div className="absolute inset-0 pointer-events-none border-[3px] border-cyan-400/70 rounded-2xl" />
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div
          className={`rounded-2xl border px-4 py-3 ${STATUS_STYLE[status] || STATUS_STYLE.idle}`}
        >
          <p className="text-sm font-semibold uppercase tracking-wide">
            {status.replace("_", " ")}
          </p>
          <p className="text-sm mt-1">{message}</p>
          {personName &&
            !message.toLowerCase().includes(personName.toLowerCase()) && (
              <p className="text-sm mt-1 font-bold">{personName}</p>
            )}
        </div>

        <div className="bg-slate-900/80 rounded-2xl p-3 border border-slate-700">
          <p className="text-xs text-slate-300 mb-2">Entry / Exit Mode</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDirection("entry")}
              className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                direction === "entry"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-700 text-slate-300"
              }`}
            >
              ↘ Entry
            </button>
            <button
              onClick={() => setDirection("exit")}
              className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                direction === "exit"
                  ? "bg-amber-600 text-white"
                  : "bg-slate-700 text-slate-300"
              }`}
            >
              ↗ Exit
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={startCamera}
            className="rounded-xl bg-cyan-600 hover:bg-cyan-500 px-3 py-2 text-sm font-semibold"
          >
            Start Camera
          </button>
          <button
            onClick={stopCamera}
            className="rounded-xl bg-slate-700 hover:bg-slate-600 px-3 py-2 text-sm font-semibold"
          >
            Stop Camera
          </button>
          <button
            onClick={() => setRunning((v) => !v)}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-sm font-semibold"
          >
            {running ? "Stop Auto Scan" : "Start Auto Scan"}
          </button>
          <button
            onClick={analyze}
            disabled={busy}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Check Face + Uniform
          </button>
          <button
            onClick={detectUniform}
            disabled={busy}
            className="rounded-xl bg-orange-600 hover:bg-orange-500 px-3 py-2 text-sm font-semibold disabled:opacity-50 col-span-2"
          >
            Detect Uniform Only
          </button>
          <button
            onClick={syncNow}
            disabled={busy}
            className="rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 px-3 py-2 text-sm font-semibold disabled:opacity-50 col-span-2"
          >
            Sync Databases (Kiosk)
          </button>
        </div>

        <div className="bg-slate-900/80 rounded-2xl p-3 border border-slate-700 space-y-2">
          <p className="text-xs text-slate-300">Guest QR Visitor Pass Scan</p>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm font-mono"
              placeholder="Paste guest QR token"
              value={qrTokenInput}
              onChange={(e) => setQrTokenInput(e.target.value)}
            />
            <button
              onClick={verifyGuestQr}
              disabled={busy}
              className="rounded-xl bg-teal-600 hover:bg-teal-500 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Verify
            </button>
          </div>
        </div>

      </div>
    </main>
  );
}

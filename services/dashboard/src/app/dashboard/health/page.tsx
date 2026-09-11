"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import {
  Activity,
  Camera,
  RefreshCw,
  Wifi,
  WifiOff,
  ShieldCheck,
  AlertTriangle,
  SearchX,
} from "lucide-react";

interface Heartbeat {
  kiosk_id: string;
  kiosk_name: string | null;
  camera_ok: boolean;
  gate_connected: boolean;
  gate_state: string | null;
  students_count: number;
  unsynced_logs: number;
  last_sync: string | null;
  fps: number | null;
  last_error: string | null;
  updated_at: string;
}

/** A kiosk is OFFLINE when it hasn't reported within this window. */
const OFFLINE_AFTER_MS = 90_000;
const POLL_INTERVAL_MS = 15_000;

function isOnline(hb: Heartbeat, now: number): boolean {
  return now - new Date(hb.updated_at).getTime() < OFFLINE_AFTER_MS;
}

function formatLastSeen(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function HealthPage() {
  const router = useRouter();
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      router.push("/login");
      return;
    }

    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      if (!session) {
        router.push("/login");
        return;
      }
      setAuthReady(true);
    });
  }, [router]);

  async function loadHeartbeats() {
    const supabase = getSupabase();
    if (!supabase) return;
    setError("");

    const { data, error: queryError } = await supabase
      .from("kiosk_heartbeats")
      .select("*")
      .order("updated_at", { ascending: false });

    if (queryError) {
      setError(queryError.message);
    } else {
      setHeartbeats(data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!authReady) return;
    void loadHeartbeats();

    // Live polling — health page stays current on its own.
    const poll = setInterval(() => {
      setNow(Date.now());
      void loadHeartbeats();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  const onlineCount = heartbeats.filter((hb) => isOnline(hb, now)).length;
  const offlineCount = heartbeats.length - onlineCount;

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black text-surface-900 tracking-tight">
            Kiosk Health
          </h1>
          <p className="text-surface-500 font-medium text-sm mt-1">
            Live status of every gate kiosk (auto-refreshes every 15s)
          </p>
        </div>
        <button onClick={loadHeartbeats} className="btn-secondary text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm font-bold bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="stat-card">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-label">Registered Kiosks</p>
            <Activity className="w-5 h-5 text-surface-400" />
          </div>
          <p className="stat-value">{heartbeats.length}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-label">Online Now</p>
            <Wifi className="w-5 h-5 text-green-500" />
          </div>
          <p className="stat-value text-green-600">{onlineCount}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-label">Offline</p>
            <WifiOff className="w-5 h-5 text-red-500" />
          </div>
          <p className="stat-value text-red-500">{offlineCount}</p>
        </div>
      </div>

      {/* Kiosk cards */}
      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-surface-200 p-12 text-center text-surface-500 font-medium">
          Loading...
        </div>
      ) : heartbeats.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-surface-200 p-16 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-surface-50 rounded-full flex items-center justify-center mb-4 border border-surface-100">
            <SearchX className="w-10 h-10 text-surface-300" />
          </div>
          <h3 className="text-lg font-bold text-surface-900 mb-1">No Kiosks Reporting</h3>
          <p className="text-surface-500 font-medium text-sm max-w-sm">
            No kiosk has sent a heartbeat yet. Open the kiosk app with internet access — it reports
            its health every 60 seconds.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {heartbeats.map((hb) => {
            const online = isOnline(hb, now);
            return (
              <div
                key={hb.kiosk_id}
                className={`bg-white rounded-2xl shadow-sm border p-6 ${
                  online ? "border-surface-200" : "border-red-200 bg-red-50/30"
                }`}
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        online ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"
                      }`}
                    >
                      {online ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 className="font-bold text-surface-900">
                        {hb.kiosk_name || "Unnamed Kiosk"}
                      </h3>
                      <p className="text-surface-400 font-mono text-xs">{hb.kiosk_id}</p>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-lg text-xs font-bold ${
                      online ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                    }`}
                  >
                    {online ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 text-surface-600 font-medium">
                    <Camera className="w-4 h-4 text-surface-400" />
                    Camera:{" "}
                    <span
                      className={
                        hb.camera_ok ? "text-green-600 font-bold" : "text-red-500 font-bold"
                      }
                    >
                      {hb.camera_ok ? "OK" : "FAIL"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-surface-600 font-medium">
                    <ShieldCheck className="w-4 h-4 text-surface-400" />
                    Gate:{" "}
                    {hb.gate_connected ? (
                      <span className="text-green-600 font-bold">
                        {hb.gate_state || "CONNECTED"}
                      </span>
                    ) : (
                      <span className="text-red-500 font-bold">NOT LINKED</span>
                    )}
                  </div>
                  <div className="text-surface-600 font-medium">
                    Profiles:{" "}
                    <span className="font-bold text-surface-900">{hb.students_count}</span>
                  </div>
                  <div className="text-surface-600 font-medium">
                    Pending sync:{" "}
                    <span
                      className={`font-bold ${hb.unsynced_logs > 0 ? "text-amber-600" : "text-surface-900"}`}
                    >
                      {hb.unsynced_logs}
                    </span>
                  </div>
                  <div className="text-surface-600 font-medium">
                    Last sync:{" "}
                    <span className="font-bold text-surface-900">
                      {hb.last_sync ? formatLastSeen(hb.last_sync) : "—"}
                    </span>
                  </div>
                  <div className="text-surface-600 font-medium">
                    Heartbeat:{" "}
                    <span className="font-bold text-surface-900">
                      {formatLastSeen(hb.updated_at)}
                    </span>
                  </div>
                  {hb.fps !== null && (
                    <div className="text-surface-600 font-medium">
                      FPS:{" "}
                      <span className="font-mono font-bold text-surface-900">
                        {Math.round(hb.fps)}
                      </span>
                    </div>
                  )}
                </div>

                {hb.last_error && (
                  <div className="mt-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Last error: {hb.last_error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  Clock,
  History,
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

  // Single-kiosk deployment: the freshest heartbeat IS the kiosk.
  // Anything older is a leftover row from a previous install or test
  // browser (older builds generated a random id per profile).
  const live = heartbeats.length > 0 ? heartbeats[0] : null;
  const stale = heartbeats.length > 1 ? heartbeats.slice(1) : [];
  const liveOnline = live ? isOnline(live, now) : false;

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black text-surface-900 tracking-tight">
            Kiosk Health
          </h1>
          <p className="text-surface-500 font-medium text-sm mt-1">
            Live status of the Gate 01 kiosk (auto-refreshes every 15s)
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

      {/* Summary — the kiosk, not a fleet */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="stat-card">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-label">Kiosk Status</p>
            {liveOnline ? (
              <Wifi className="w-5 h-5 text-green-500" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-500" />
            )}
          </div>
          <p
            className={`stat-value ${!live ? "" : liveOnline ? "text-green-600" : "text-red-500"}`}
          >
            {!live ? "—" : liveOnline ? "ONLINE" : "OFFLINE"}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-label">Camera</p>
            <Camera className="w-5 h-5 text-surface-400" />
          </div>
          <p
            className={`stat-value ${!live ? "" : live.camera_ok ? "text-green-600" : "text-red-500"}`}
          >
            {!live ? "—" : live.camera_ok ? "OK" : "FAIL"}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-label">Last Heartbeat</p>
            <Clock className="w-5 h-5 text-surface-400" />
          </div>
          <p className="stat-value">{!live ? "—" : formatLastSeen(live.updated_at)}</p>
        </div>
      </div>

      {/* The kiosk */}
      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-surface-200 p-12 text-center text-surface-500 font-medium">
          Loading...
        </div>
      ) : !live ? (
        <div className="bg-white rounded-2xl shadow-sm border border-surface-200 p-16 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-surface-50 rounded-full flex items-center justify-center mb-4 border border-surface-100">
            <SearchX className="w-10 h-10 text-surface-300" />
          </div>
          <h3 className="text-lg font-bold text-surface-900 mb-1">No Kiosk Reporting</h3>
          <p className="text-surface-500 font-medium text-sm max-w-sm">
            The kiosk has not sent a heartbeat yet. Open the kiosk app with internet access — it
            reports its health every 60 seconds.
          </p>
        </div>
      ) : (
        <div
          className={`bg-white rounded-2xl shadow-sm border p-6 ${
            liveOnline ? "border-surface-200" : "border-red-200 bg-red-50/30"
          }`}
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  liveOnline ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"
                }`}
              >
                {liveOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="font-bold text-surface-900">{live.kiosk_name || "Gate 01"}</h3>
                <p className="text-surface-400 font-mono text-xs">{live.kiosk_id}</p>
              </div>
            </div>
            <span
              className={`px-3 py-1 rounded-lg text-xs font-bold ${
                liveOnline ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
              }`}
            >
              {liveOnline ? "ONLINE" : "OFFLINE"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-surface-600 font-medium">
              <Camera className="w-4 h-4 text-surface-400" />
              Camera:{" "}
              <span
                className={live.camera_ok ? "text-green-600 font-bold" : "text-red-500 font-bold"}
              >
                {live.camera_ok ? "OK" : "FAIL"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-surface-600 font-medium">
              <ShieldCheck className="w-4 h-4 text-surface-400" />
              Gate:{" "}
              {live.gate_connected ? (
                <span className="text-green-600 font-bold">{live.gate_state || "CONNECTED"}</span>
              ) : (
                <span className="text-red-500 font-bold">NOT LINKED</span>
              )}
            </div>
            <div className="text-surface-600 font-medium">
              Profiles: <span className="font-bold text-surface-900">{live.students_count}</span>
            </div>
            <div className="text-surface-600 font-medium">
              Pending sync:{" "}
              <span
                className={`font-bold ${live.unsynced_logs > 0 ? "text-amber-600" : "text-surface-900"}`}
              >
                {live.unsynced_logs}
              </span>
            </div>
            <div className="text-surface-600 font-medium">
              Last sync:{" "}
              <span className="font-bold text-surface-900">
                {live.last_sync ? formatLastSeen(live.last_sync) : "—"}
              </span>
            </div>
            <div className="text-surface-600 font-medium">
              Heartbeat:{" "}
              <span className="font-bold text-surface-900">{formatLastSeen(live.updated_at)}</span>
            </div>
            {live.fps !== null && (
              <div className="text-surface-600 font-medium">
                FPS:{" "}
                <span className="font-mono font-bold text-surface-900">{Math.round(live.fps)}</span>
              </div>
            )}
          </div>

          {live.last_error && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Last error: {live.last_error}
            </div>
          )}
        </div>
      )}

      {/* Older rows are leftovers, not a fleet — collapsed out of the way */}
      {stale.length > 0 && (
        <div className="mt-6 bg-white rounded-2xl shadow-sm border border-surface-200 p-6">
          <div className="flex items-center gap-2.5 mb-2">
            <History className="w-4 h-4 text-surface-400" />
            <h3 className="font-bold text-surface-900 text-sm">
              {stale.length} older record{stale.length === 1 ? "" : "s"} — not live kiosks
            </h3>
          </div>
          <p className="text-xs text-surface-500 font-medium mb-4">
            Leftover rows from previous installs or test browsers (older builds made a random id per
            profile). The card above is the real kiosk. Clear these rows in Supabase to empty this
            list:{" "}
            <code className="font-mono bg-surface-100 px-1.5 py-0.5 rounded">
              delete from kiosk_heartbeats where kiosk_id != &apos;gate-01&apos;
            </code>
          </p>
          <div className="divide-y divide-surface-50">
            {stale.map((hb) => (
              <div
                key={hb.kiosk_id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Activity className="w-4 h-4 text-surface-300 shrink-0" />
                  <span className="font-bold text-surface-700 truncate">
                    {hb.kiosk_name || "Unnamed"}
                  </span>
                  <span className="font-mono text-xs text-surface-400 truncate">{hb.kiosk_id}</span>
                </div>
                <span className="text-xs font-semibold text-surface-400 shrink-0">
                  last seen {formatLastSeen(hb.updated_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

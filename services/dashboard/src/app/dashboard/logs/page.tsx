"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

interface AccessLog {
  id: string;
  person_name: string | null;
  person_type: string | null;
  method: string;
  success: boolean;
  confidence: number | null;
  uniform_ok: boolean | null;
  failure_reason: string | null;
  device_timestamp: string;
  created_at: string;
}

export default function LogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "granted" | "denied">("all");
  const [dateRange, setDateRange] = useState("24h");

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) { router.push("/login"); return; }
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push("/login");
    });
  }, [router]);

  useEffect(() => {
    loadLogs();
  }, [filter, dateRange]);

  async function loadLogs() {
    const supabase = getSupabase();
    if (!supabase) return;
    setLoading(true);

    const now = new Date();
    let since: Date;
    switch (dateRange) {
      case "1h": since = new Date(now.getTime() - 60 * 60 * 1000); break;
      case "24h": since = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
      case "7d": since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case "30d": since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      default: since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    let query = supabase
      .from("access_logs")
      .select("*")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(200);

    if (filter === "granted") query = query.eq("success", true);
    else if (filter === "denied") query = query.eq("success", false);

    const { data } = await query;
    if (data) setLogs(data);
    setLoading(false);
  }

  function formatTimestamp(ts: string) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return d.toLocaleDateString();
  }

  return (
    <div className="min-h-screen bg-surface-950 p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">📋 Access Logs</h1>
          <p className="text-surface-400 text-sm mt-1">{logs.length} events in selected period</p>
        </div>
        <button onClick={loadLogs} className="btn-secondary text-sm">
          🔄 Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex gap-2">
          {(["all", "granted", "denied"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                filter === f
                  ? "bg-primary-600 text-white"
                  : "bg-surface-800 text-surface-400 hover:bg-surface-700"
              }`}
            >
              {f === "all" ? "All" : f === "granted" ? "✅ Granted" : "❌ Denied"}
            </button>
          ))}
        </div>

        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="px-4 py-2 bg-surface-800 border border-surface-700 rounded-xl text-white text-sm focus:border-primary-500 focus:outline-none"
        >
          <option value="1h">Last hour</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      {/* Logs */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-surface-400">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-surface-400">No access logs found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-800">
                  <th className="table-header">Time</th>
                  <th className="table-header">Person</th>
                  <th className="table-header">Type</th>
                  <th className="table-header">Method</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Confidence</th>
                  <th className="table-header">Uniform</th>
                  <th className="table-header">Reason</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors">
                    <td className="table-cell text-surface-400 text-xs whitespace-nowrap">
                      {formatTimestamp(log.created_at)}
                    </td>
                    <td className="table-cell font-medium text-white">
                      {log.person_name || "Unknown"}
                    </td>
                    <td className="table-cell text-surface-400 text-xs">
                      {log.person_type || "—"}
                    </td>
                    <td className="table-cell">
                      <span className="text-xs font-mono text-surface-400 uppercase">
                        {log.method}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-md text-xs font-medium ${
                        log.success ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                      }`}>
                        {log.success ? "GRANTED" : "DENIED"}
                      </span>
                    </td>
                    <td className="table-cell font-mono text-xs text-surface-400">
                      {log.confidence ? `${(log.confidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="table-cell">
                      {log.uniform_ok !== null ? (
                        <span className={log.uniform_ok ? "text-green-400" : "text-red-400"}>
                          {log.uniform_ok ? "✓ OK" : "✗ FAIL"}
                        </span>
                      ) : (
                        <span className="text-surface-500">—</span>
                      )}
                    </td>
                    <td className="table-cell text-surface-400 text-xs max-w-48 truncate">
                      {log.failure_reason || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

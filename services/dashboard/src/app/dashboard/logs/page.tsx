"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { ClipboardList, RefreshCw, CheckCircle2, XCircle, SearchX } from "lucide-react";

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
    if (!supabase) {
      router.push("/login");
      return;
    }

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
      case "1h":
        since = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case "24h":
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "7d":
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
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
    <div className="min-h-screen p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-surface-200 flex items-center justify-center">
            <ClipboardList className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-900">Access Logs</h1>
            <p className="text-surface-500 font-medium text-sm mt-1">{logs.length} events in selected period</p>
          </div>
        </div>
        <button onClick={loadLogs} className="btn-secondary text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex gap-2">
          {(["all", "granted", "denied"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2 ${
                filter === f
                  ? "bg-primary-600 text-white shadow-md"
                  : "bg-white border border-surface-200 text-surface-700 hover:bg-surface-50"
              }`}
            >
              {f === "granted" && <CheckCircle2 className="w-4 h-4" />}
              {f === "denied" && <XCircle className="w-4 h-4" />}
              {f === "all" ? "All" : f === "granted" ? "Granted" : "Denied"}
            </button>
          ))}
        </div>

        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="px-4 py-2 bg-white border border-surface-200 rounded-xl text-surface-900 font-bold text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        >
          <option value="1h">Last hour</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      {/* Logs */}
      <div className="bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-surface-500 font-medium">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="p-16 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-surface-50 rounded-full flex items-center justify-center mb-4 border border-surface-100">
              <SearchX className="w-10 h-10 text-surface-300" />
            </div>
            <h3 className="text-lg font-bold text-surface-900 mb-1">No Access Logs Found</h3>
            <p className="text-surface-500 font-medium text-sm max-w-sm">
              There are no access attempts matching your current filters or date range.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50/50">
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
                  <tr
                    key={log.id}
                    className="border-b border-surface-50 hover:bg-surface-50 transition-colors"
                  >
                    <td className="table-cell text-surface-500 font-medium text-xs whitespace-nowrap">
                      {formatTimestamp(log.created_at)}
                    </td>
                    <td className="table-cell font-bold text-surface-900">
                      {log.person_name || "Unknown"}
                    </td>
                    <td className="table-cell text-surface-500 font-medium text-xs">
                      {log.person_type || "—"}
                    </td>
                    <td className="table-cell">
                      <span className="text-xs font-bold font-mono text-surface-500 uppercase">
                        {log.method}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span
                        className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 w-max ${
                          log.success
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {log.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {log.success ? "GRANTED" : "DENIED"}
                      </span>
                    </td>
                    <td className="table-cell font-mono font-medium text-xs text-surface-500">
                      {log.confidence ? `${(log.confidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="table-cell">
                      {log.uniform_ok !== null ? (
                        <span className={`font-bold flex items-center gap-1 text-xs ${log.uniform_ok ? "text-green-600" : "text-red-600"}`}>
                          {log.uniform_ok ? <><CheckCircle2 className="w-3 h-3"/> OK</> : <><XCircle className="w-3 h-3"/> FAIL</>}
                        </span>
                      ) : (
                        <span className="text-surface-400 font-medium">—</span>
                      )}
                    </td>
                    <td className="table-cell text-surface-500 font-medium text-xs max-w-48 truncate">
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

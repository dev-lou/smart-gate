"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { ClipboardList, RefreshCw, CheckCircle2, XCircle, SearchX } from "lucide-react";
import {
  countArrivals,
  formatRelative,
  formatScanClock,
  formatScanTime,
  summarizeDay,
  type AccessLogLike,
} from "@/lib/attendance";

interface AccessLog {
  id: string;
  person_name: string | null;
  person_type: string | null;
  method: string;
  success: boolean;
  confidence: number | null;
  uniform_ok: boolean | null;
  failure_reason: string | null;
  gate_state: string | null;
  direction: string | null;
  device_timestamp: string;
  created_at: string;
}

export default function LogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "granted" | "denied">("all");
  const [dateRange, setDateRange] = useState("24h");
  /**
   * Today's granted reads, fetched separately from the table so the attendance
   * panel always covers the whole day regardless of the table's date filter.
   */
  const [todayGrants, setTodayGrants] = useState<AccessLogLike[]>([]);

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

  useEffect(() => {
    if (authReady) void loadLogs();
  }, [authReady, filter, dateRange]);

  async function loadLogs() {
    const supabase = getSupabase();
    if (!supabase) return;
    setLoading(true);
    setError("");

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

    // Filter and sort on the SCAN time. `created_at` is only when the row
    // reached the cloud, so a kiosk that was offline makes yesterday's reads
    // look like they happened minutes ago.
    let query = supabase
      .from("access_logs")
      .select("*")
      .gte("device_timestamp", since.toISOString())
      .order("device_timestamp", { ascending: false })
      .limit(200);

    if (filter === "granted") query = query.eq("success", true);
    else if (filter === "denied") query = query.eq("success", false);

    const { data, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message);
      setLogs([]);
    } else {
      setLogs(data ?? []);
    }

    // Attendance panel data: today's grants only, ignoring the table filters.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { data: todayData } = await supabase
      .from("access_logs")
      .select("person_name, success, device_timestamp, direction")
      .gte("device_timestamp", startOfToday.toISOString())
      .eq("success", true)
      .order("device_timestamp", { ascending: true })
      .limit(1000);
    setTodayGrants((todayData ?? []) as AccessLogLike[]);

    setLoading(false);
  }

  const attendance = summarizeDay(todayGrants, new Date());
  const arrivals = countArrivals(attendance);

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black text-surface-900 tracking-tight">
            Access Logs
          </h1>
          <p className="text-surface-500 font-medium text-sm mt-1">
            {logs.length} events in selected period
          </p>
        </div>
        <button onClick={loadLogs} className="btn-secondary text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm font-bold bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

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

      {/* Today's attendance — one arrival per session, per person. A student
          crossing twice a day is normal, so this is the reading that matters;
          the table below stays the raw audit trail. */}
      {attendance.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-surface-900 tracking-tight uppercase">
                Today&apos;s Attendance
              </h2>
              <p className="text-surface-500 font-medium text-xs mt-0.5">
                First granted read of each session — counts a morning and an afternoon arrival
              </p>
            </div>
            <span className="text-xs font-bold text-surface-500 shrink-0">
              {arrivals} arrival{arrivals === 1 ? "" : "s"}
            </span>
          </div>
          <div className="divide-y divide-surface-50">
            {attendance.map((row) => (
              <div key={row.name} className="px-5 py-3 flex items-center gap-3 sm:gap-4">
                <span className="font-bold text-surface-900 text-sm flex-1 min-w-0 truncate">
                  {row.name}
                </span>
                <span className="text-xs font-mono text-surface-400 shrink-0 hidden sm:block">
                  {row.reads} read{row.reads === 1 ? "" : "s"}
                </span>
                <span
                  className={`px-2.5 py-1 rounded-md text-xs font-bold shrink-0 ${
                    row.amFirst
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-surface-100 text-surface-400"
                  }`}
                >
                  AM {row.amFirst ? formatScanClock(row.amFirst) : "—"}
                </span>
                <span
                  className={`px-2.5 py-1 rounded-md text-xs font-bold shrink-0 ${
                    row.pmFirst
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-surface-100 text-surface-400"
                  }`}
                >
                  PM {row.pmFirst ? formatScanClock(row.pmFirst) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <th className="table-header">Direction</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Confidence</th>
                  <th className="table-header">Uniform</th>
                  <th className="table-header">Gate</th>
                  <th className="table-header">Reason</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-surface-50 hover:bg-surface-50 transition-colors"
                  >
                    <td className="table-cell whitespace-nowrap">
                      <span className="block text-surface-900 font-bold text-xs">
                        {formatScanTime(log.device_timestamp)}
                      </span>
                      {/* Relative against the SCAN time, not the upload time. */}
                      <span className="block text-surface-400 font-medium text-[11px]">
                        {formatRelative(log.device_timestamp)}
                      </span>
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
                      <span className="text-xs font-bold text-surface-500 uppercase">
                        {log.direction || "—"}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span
                        className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 w-max ${
                          log.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                        }`}
                      >
                        {log.success ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <XCircle className="w-3 h-3" />
                        )}
                        {log.success ? "GRANTED" : "DENIED"}
                      </span>
                    </td>
                    <td className="table-cell font-mono font-medium text-xs text-surface-500">
                      {log.confidence ? `${(log.confidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="table-cell">
                      {log.uniform_ok !== null ? (
                        <span
                          className={`font-bold flex items-center gap-1 text-xs ${log.uniform_ok ? "text-green-600" : "text-red-600"}`}
                        >
                          {log.uniform_ok ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" /> OK
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3" /> FAIL
                            </>
                          )}
                        </span>
                      ) : (
                        <span className="text-surface-400 font-medium">—</span>
                      )}
                    </td>
                    <td className="table-cell">
                      {log.gate_state ? (
                        <span
                          className={`px-2 py-1 rounded-md text-xs font-bold uppercase ${
                            log.gate_state === "open"
                              ? "bg-green-50 text-green-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {log.gate_state}
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

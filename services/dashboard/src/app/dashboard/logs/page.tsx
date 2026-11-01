"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import {
  ClipboardList,
  RefreshCw,
  CheckCircle2,
  XCircle,
  SearchX,
  Printer,
  Download,
  FileText,
  Search,
  X,
} from "lucide-react";
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
  const [search, setSearch] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
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

  // ─── Client-side name search over the loaded (capped) rows ───
  const visibleLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        (l.person_name || "").toLowerCase().includes(q) ||
        (l.person_type || "").toLowerCase().includes(q) ||
        (l.method || "").toLowerCase().includes(q) ||
        (l.failure_reason || "").toLowerCase().includes(q),
    );
  }, [logs, search]);

  // ─── Report (built from the same filtered rows as the table) ───
  const report = useMemo(() => {
    const granted = visibleLogs.filter((l) => l.success).length;
    const denied = visibleLogs.length - granted;
    const byMethod: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const l of visibleLogs) {
      byMethod[l.method || "unknown"] = (byMethod[l.method || "unknown"] || 0) + 1;
      byType[l.person_type || "unknown"] = (byType[l.person_type || "unknown"] || 0) + 1;
    }
    return {
      total: visibleLogs.length,
      granted,
      denied,
      rate: visibleLogs.length > 0 ? Math.round((granted / visibleLogs.length) * 100) : 0,
      byMethod,
      byType,
    };
  }, [visibleLogs]);

  const dateRangeLabel =
    dateRange === "1h"
      ? "Last hour"
      : dateRange === "24h"
        ? "Last 24 hours"
        : dateRange === "7d"
          ? "Last 7 days"
          : "Last 30 days";

  function downloadCsv() {
    const header = [
      "Time",
      "Person",
      "Type",
      "Method",
      "Direction",
      "Status",
      "Confidence %",
      "Uniform OK",
      "Gate",
      "Reason",
    ];
    const esc = (v: string | number | null | undefined) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = visibleLogs.map((l) =>
      [
        formatScanTime(l.device_timestamp),
        l.person_name || "Unknown",
        l.person_type || "",
        l.method,
        l.direction || "",
        l.success ? "GRANTED" : "DENIED",
        l.confidence !== null ? Math.round(l.confidence * 100) : "",
        l.uniform_ok === null ? "" : l.uniform_ok ? "OK" : "FAIL",
        l.gate_state || "",
        l.failure_reason || "",
      ]
        .map(esc)
        .join(","),
    );
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `access-report-${filter}-${dateRange}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    window.print();
  }

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReportOpen(true)}
            disabled={loading || visibleLogs.length === 0}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            Generate Report
          </button>
          <button onClick={loadLogs} className="btn-secondary text-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm font-bold bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-surface-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, type, method, or reason..."
            className="input-field pl-10"
          />
        </div>
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
        ) : visibleLogs.length === 0 ? (
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
                {visibleLogs.map((log) => (
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

      {/* ─── Printable report modal ─── */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-surface-900/40 backdrop-blur-sm no-print"
            onClick={() => setReportOpen(false)}
          />
          <div className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-surface-100 flex items-center justify-between no-print">
              <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary-500" />
                Access Report
              </h2>
              <button
                onClick={() => setReportOpen(false)}
                className="p-2 hover:bg-surface-100 rounded-full transition-colors text-surface-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Print-only + on-screen report body */}
            <div id="access-report" className="p-6 sm:p-8 overflow-y-auto">
              <div className="mb-6">
                <h1 className="text-2xl font-black text-surface-900">Smart Gate — Access Report</h1>
                <p className="text-sm text-surface-500 font-medium mt-1">
                  {dateRangeLabel} · Status: {filter === "all" ? "All" : filter} ·
                  {search.trim() ? ` Search: "${search.trim()}" ·` : ""} Generated{" "}
                  {new Date().toLocaleString()} · {report.total} event
                  {report.total === 1 ? "" : "s"}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[
                  { label: "Total events", value: report.total },
                  { label: "Granted", value: report.granted },
                  { label: "Denied", value: report.denied },
                  { label: "Grant rate", value: `${report.rate}%` },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="border border-surface-200 rounded-xl p-4 text-center"
                  >
                    <p className="text-2xl font-black text-surface-900">{s.value}</p>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-surface-500 mt-1">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 text-sm">
                <div className="border border-surface-200 rounded-xl p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-surface-500 mb-2">
                    By method
                  </p>
                  {Object.entries(report.byMethod).map(([m, c]) => (
                    <p key={m} className="flex justify-between font-medium text-surface-700">
                      <span className="uppercase font-mono text-xs">{m}</span>
                      <span className="font-bold">{c}</span>
                    </p>
                  ))}
                </div>
                <div className="border border-surface-200 rounded-xl p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-surface-500 mb-2">
                    By person type
                  </p>
                  {Object.entries(report.byType).map(([t, c]) => (
                    <p key={t} className="flex justify-between font-medium text-surface-700">
                      <span>{t}</span>
                      <span className="font-bold">{c}</span>
                    </p>
                  ))}
                </div>
              </div>

              <table className="w-full text-sm report-table">
                <thead>
                  <tr className="border-b-2 border-surface-900">
                    <th className="text-left py-2 pr-3 font-bold">Time</th>
                    <th className="text-left py-2 pr-3 font-bold">Person</th>
                    <th className="text-left py-2 pr-3 font-bold">Method</th>
                    <th className="text-left py-2 pr-3 font-bold">Status</th>
                    <th className="text-left py-2 font-bold">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLogs.map((l) => (
                    <tr key={l.id} className="border-b border-surface-100">
                      <td className="py-2 pr-3 whitespace-nowrap text-xs">
                        {formatScanTime(l.device_timestamp)}
                      </td>
                      <td className="py-2 pr-3 font-bold">{l.person_name || "Unknown"}</td>
                      <td className="py-2 pr-3 uppercase font-mono text-xs">{l.method}</td>
                      <td className="py-2 pr-3 font-bold">{l.success ? "GRANTED" : "DENIED"}</td>
                      <td className="py-2 text-xs text-surface-600">{l.failure_reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-6 border-t border-surface-100 flex flex-col sm:flex-row justify-end gap-2 no-print">
              <button
                onClick={() => setReportOpen(false)}
                className="px-4 py-2.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-xl text-sm font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={downloadCsv}
                className="px-5 py-2.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-xl text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Download CSV
              </button>
              <button
                onClick={printReport}
                className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Print Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print CSS: only the report prints, never the app chrome */}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #access-report, #access-report * { visibility: visible !important; }
        #access-report {
          position: absolute !important;
          inset: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          padding: 0 !important;
        }
        #access-report .report-table { font-size: 11px; }
      }`}</style>
    </div>
  );
}

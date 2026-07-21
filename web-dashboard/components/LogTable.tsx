"use client";

import { AccessLog } from "@/types";

interface LogTableProps {
  logs: AccessLog[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
}

const methodIcons: Record<string, string> = {
  face: "Face",
  fingerprint: "Finger",
  rfid: "RFID",
  qr: "QR",
  manual: "Manual",
};

const methodColors: Record<string, string> = {
  face: "badge-info",
  fingerprint: "badge-warning",
  rfid: "badge-success",
  qr: "badge-success",
  manual: "badge-info",
};

export default function LogTable({
  logs,
  total,
  page,
  onPageChange,
}: LogTableProps) {
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  if (logs.length === 0) {
    return (
      <div className="text-center py-16">
        <svg
          className="w-16 h-16 mx-auto text-surface-400 dark:text-surface-600 mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <p className="text-surface-500 dark:text-surface-400 text-lg">No access logs yet</p>
        <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
          Logs will appear when the gate processes entries
        </p>
      </div>
    );
  }

  const formatTimestamp = (ts: string) => {
    try {
      const date = new Date(ts);
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Person</th>
              <th>Direction</th>
              <th>Method</th>
              <th>Result</th>
              <th>Confidence</th>
              <th>Uniform</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="text-surface-500 dark:text-surface-400 text-sm whitespace-nowrap">
                  {formatTimestamp(log.device_timestamp)}
                </td>
                <td>
                  <span className="font-medium text-surface-900 dark:text-white">
                    {log.person_name || "Unknown"}
                  </span>
                </td>
                <td>
                  <span
                    className={`badge ${log.direction === "exit" ? "badge-warning" : "badge-info"}`}
                  >
                    {log.direction === "exit" ? "Exit" : "Entry"}
                  </span>
                </td>
                <td>
                  <span
                    className={`badge ${methodColors[log.method] || "badge-info"}`}
                  >
                    {methodIcons[log.method] || "?"} {log.method}
                  </span>
                </td>
                <td>
                  <span
                    className={`badge ${log.success ? "badge-success" : "badge-danger"}`}
                  >
                    {log.success ? "Granted" : "Denied"}
                  </span>
                </td>
                <td className="text-surface-500 dark:text-surface-400 font-mono text-sm">
                  {log.confidence != null
                    ? `${(log.confidence * 100).toFixed(1)}%`
                    : "—"}
                </td>
                <td>
                  {log.uniform_ok != null ? (
                    <span
                      className={`badge ${log.uniform_ok ? "badge-success" : "badge-danger"}`}
                    >
                      {log.uniform_ok ? "Pass" : "Fail"}
                    </span>
                  ) : (
                    <span className="text-surface-500 dark:text-surface-400">—</span>
                  )}
                </td>
                <td className="text-surface-500 dark:text-surface-400 text-sm max-w-xs truncate">
                  {log.override_reason || log.failure_reason || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 px-2">
          <p className="text-surface-500 dark:text-surface-400 text-sm">
            Showing {page * pageSize + 1}–
            {Math.min((page + 1) * pageSize, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(Math.max(0, page - 1))}
              disabled={page === 0}
              className="btn-secondary text-xs disabled:opacity-30"
            >
              ← Previous
            </button>
            <span className="text-surface-500 dark:text-surface-400 text-sm px-3">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="btn-secondary text-xs disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

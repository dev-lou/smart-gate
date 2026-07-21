"use client";

import { useCallback, useEffect, useState } from "react";

type AuditLog = {
  id: string;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/audit-logs?limit=100");
      const data = await res.json();
      setLogs(data.audit_logs || []);
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatDate = (value: string) => {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
            Audit Logs
          </h1>
          <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
            Dashboard and guard workflow accountability records.
          </p>
        </div>
        <button onClick={fetchLogs} className="btn-secondary">
          Refresh
        </button>
      </div>

      <div className="glass-card p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <p className="text-surface-500 text-center py-12">No audit logs yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="text-surface-500 dark:text-surface-400 text-sm whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="text-surface-900 dark:text-white font-medium">{log.actor_name || "System"}</td>
                    <td>
                      <span className="badge badge-info">{log.action.replaceAll("_", " ")}</span>
                    </td>
                    <td className="text-surface-500 dark:text-surface-400 text-sm">
                      {log.entity_type}
                      {log.entity_id ? ` / ${log.entity_id.slice(0, 8)}` : ""}
                    </td>
                    <td className="text-surface-500 dark:text-surface-400 text-xs max-w-md truncate">
                      {log.details ? JSON.stringify(log.details) : "—"}
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

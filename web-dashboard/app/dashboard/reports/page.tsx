"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessLog, GuestVisit } from "@/types";

type Summary = {
  total: number;
  granted: number;
  denied: number;
  entry: number;
  exit: number;
  guestsInside: number;
  registeredInside: number;
  uniformViolations: number;
  manualOverrides: number;
};

export default function ReportsPage() {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [guestVisits, setGuestVisits] = useState<GuestVisit[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReportData = useCallback(async () => {
    setLoading(true);
    try {
      const [logRes, guestRes] = await Promise.all([
        fetch("/api/logs?limit=5000&offset=0"),
        fetch("/api/guest-visits?limit=500"),
      ]);
      const logData = await logRes.json();
      const guestData = await guestRes.json();
      setLogs(logData.logs || []);
      setGuestVisits(guestData.guest_visits || []);
    } catch (error) {
      console.error("Failed to load report data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  const summary: Summary = useMemo(() => {
    const successfulLogs = logs.filter((log) => log.success);
    const latestByPerson = new Map<string, AccessLog>();

    for (const log of successfulLogs) {
      if (!log.person_id || log.person_type === "guest" || log.person_type === "manual") continue;
      const current = latestByPerson.get(log.person_id);
      if (!current || new Date(log.device_timestamp) > new Date(current.device_timestamp)) {
        latestByPerson.set(log.person_id, log);
      }
    }

    const registeredInside = Array.from(latestByPerson.values()).filter(
      (log) => log.direction === "entry",
    ).length;

    return {
      total: logs.length,
      granted: logs.filter((log) => log.success).length,
      denied: logs.filter((log) => !log.success).length,
      entry: logs.filter((log) => log.direction === "entry").length,
      exit: logs.filter((log) => log.direction === "exit").length,
      guestsInside: guestVisits.filter((visit) => visit.status.includes("inside")).length,
      registeredInside,
      uniformViolations: logs.filter((log) => log.uniform_ok === false).length,
      manualOverrides: logs.filter((log) => log.method === "manual").length,
    };
  }, [logs, guestVisits]);

  const exportCsv = () => {
    const csvEscape = (value: unknown) => {
      const text = value == null ? "" : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [
      ["Metric", "Value"],
      ["Total Logs", summary.total],
      ["Granted", summary.granted],
      ["Denied", summary.denied],
      ["Entry Events", summary.entry],
      ["Exit Events", summary.exit],
      ["Registered Inside", summary.registeredInside],
      ["Guests Inside", summary.guestsInside],
      ["Uniform Violations", summary.uniformViolations],
      ["Manual Overrides", summary.manualOverrides],
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `smart-access-report-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const cards = [
    { label: "Total Events", value: summary.total },
    { label: "Granted", value: summary.granted },
    { label: "Denied", value: summary.denied },
    { label: "Entries", value: summary.entry },
    { label: "Exits", value: summary.exit },
    { label: "Registered Inside", value: summary.registeredInside },
    { label: "Guests Inside", value: summary.guestsInside },
    { label: "Uniform Violations", value: summary.uniformViolations },
    { label: "Manual Overrides", value: summary.manualOverrides },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
            Reports
          </h1>
          <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
            Summary reports for entry/exit monitoring, uniform compliance, guests, and overrides.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="btn-secondary">
            Export Summary CSV
          </button>
          <button onClick={fetchReportData} className="btn-primary">
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="glass-card p-12 flex justify-center">
          <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((card) => (
              <div key={card.label} className="glass-card p-5">
                <p className="text-surface-500 dark:text-surface-400 text-sm">{card.label}</p>
                <p className="text-3xl font-bold text-surface-900 dark:text-white mt-2">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold mb-4">Report Coverage</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-surface-500 dark:text-surface-400">
              <div className="p-4 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-300 dark:border-surface-700">
                <p className="font-semibold text-surface-900 dark:text-white mb-1">Daily Access Report</p>
                <p>Use Access Logs with date filters and CSV export.</p>
              </div>
              <div className="p-4 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-300 dark:border-surface-700">
                <p className="font-semibold text-surface-900 dark:text-white mb-1">Guest Visit Report</p>
                <p>Use Guest Visits with time-in/time-out and CSV export.</p>
              </div>
              <div className="p-4 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-300 dark:border-surface-700">
                <p className="font-semibold text-surface-900 dark:text-white mb-1">Uniform Compliance Report</p>
                <p>Uniform violations are counted from access logs with failed uniform checks.</p>
              </div>
              <div className="p-4 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-300 dark:border-surface-700">
                <p className="font-semibold text-surface-900 dark:text-white mb-1">Manual Override Report</p>
                <p>Manual override records are filtered by method = manual in Access Logs.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

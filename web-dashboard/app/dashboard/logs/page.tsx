"use client";

import { useEffect, useState, useCallback } from "react";
import { AccessLog } from "@/types";
import LogTable from "@/components/LogTable";
import CustomSelect from "@/components/CustomSelect";
import CustomDatePicker from "@/components/CustomDatePicker";

export default function LogsPage() {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterSuccess, setFilterSuccess] = useState("");
  const [filterMethod, setFilterMethod] = useState("");
  const [filterDirection, setFilterDirection] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState<Date | null>(null);
  const [filterDateTo, setFilterDateTo] = useState<Date | null>(null);

  const pageSize = 20;

  const buildParams = useCallback(
    (limit: number, offset: number) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (filterSuccess) params.set("success", filterSuccess);
      if (filterMethod) params.set("method", filterMethod);
      if (filterDirection) params.set("direction", filterDirection);
      if (filterDateFrom) params.set("date_from", filterDateFrom.toISOString().split('T')[0]);
      if (filterDateTo) params.set("date_to", filterDateTo.toISOString().split('T')[0]);
      return params;
    },
    [
      filterSuccess,
      filterMethod,
      filterDirection,
      filterDateFrom,
      filterDateTo,
    ],
  );

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams(pageSize, page * pageSize);

      const res = await fetch(`/api/logs?${params.toString()}`);
      const data = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, [page, buildParams]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const clearFilters = () => {
    setFilterSuccess("");
    setFilterMethod("");
    setFilterDirection("");
    setFilterDateFrom(null);
    setFilterDateTo(null);
    setPage(0);
  };

  const csvEscape = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };

  const exportCsv = async () => {
    try {
      const params = buildParams(5000, 0);
      const res = await fetch(`/api/logs?${params.toString()}`);
      const data = await res.json();
      const exportRows: AccessLog[] = data.logs || [];
      const header = [
        "timestamp",
        "direction",
        "person_type",
        "person_name",
        "method",
        "success",
        "confidence",
        "uniform_ok",
        "gate_id",
        "details",
      ];
      const rows = exportRows.map((log) => [
        log.device_timestamp,
        log.direction,
        log.person_type || "",
        log.person_name || "",
        log.method,
        log.success ? "granted" : "denied",
        log.confidence ?? "",
        log.uniform_ok ?? "",
        log.gate_id,
        log.override_reason || log.failure_reason || "",
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map(csvEscape).join(","))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `access-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export logs:", err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
          Access Logs
        </h1>
        <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
          {total} total log entr{total !== 1 ? "ies" : "y"}
        </p>
      </div>

      {/* Filters */}
      <div className="glass-card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[160px] max-w-xs">
            <label htmlFor="filter-result" className="input-label">
              Result
            </label>
            <CustomSelect
              options={[
                { label: "All", value: "" },
                { label: "Granted", value: "true" },
                { label: "Denied", value: "false" }
              ]}
              value={filterSuccess ? { label: filterSuccess === "true" ? "Granted" : "Denied", value: filterSuccess } : { label: "All", value: "" }}
              onChange={(option) => {
                setFilterSuccess(option?.value || "");
                setPage(0);
              }}
              placeholder="All"
            />
          </div>
          <div className="flex-1 min-w-[160px] max-w-xs">
            <label htmlFor="filter-method" className="input-label">
              Method
            </label>
            <CustomSelect
              options={[
                { label: "All", value: "" },
                { label: "Face", value: "face" },
                { label: "Fingerprint", value: "fingerprint" },
                { label: "RFID", value: "rfid" },
                { label: "QR", value: "qr" },
                { label: "Manual", value: "manual" }
              ]}
              value={filterMethod ? { label: filterMethod.charAt(0).toUpperCase() + filterMethod.slice(1), value: filterMethod } : { label: "All", value: "" }}
              onChange={(option) => {
                setFilterMethod(option?.value || "");
                setPage(0);
              }}
              placeholder="All"
            />
          </div>
          <div className="flex-1 min-w-[160px] max-w-xs">
            <label htmlFor="filter-direction" className="input-label">
              Direction
            </label>
            <CustomSelect
              options={[
                { label: "All", value: "" },
                { label: "Entry", value: "entry" },
                { label: "Exit", value: "exit" }
              ]}
              value={filterDirection ? { label: filterDirection.charAt(0).toUpperCase() + filterDirection.slice(1), value: filterDirection } : { label: "All", value: "" }}
              onChange={(option) => {
                setFilterDirection(option?.value || "");
                setPage(0);
              }}
              placeholder="All"
            />
          </div>
          <div className="flex-1 min-w-[160px] max-w-xs">
            <label htmlFor="filter-from" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              From
            </label>
            <div className="w-full">
              <CustomDatePicker
                selected={filterDateFrom}
                onChange={(date) => {
                  setFilterDateFrom(date);
                  setPage(0);
                }}
                placeholder="From date"
                dateFormat="dd/MM/yyyy"
              />
            </div>
          </div>
          <div className="flex-1 min-w-[160px] max-w-xs">
            <label htmlFor="filter-to" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              To
            </label>
            <div className="w-full">
              <CustomDatePicker
                selected={filterDateTo}
                onChange={(date) => {
                  setFilterDateTo(date);
                  setPage(0);
                }}
                placeholder="To date"
                dateFormat="dd/MM/yyyy"
              />
            </div>
          </div>
          <button onClick={clearFilters} className="btn-secondary">
            Clear Filters
          </button>
          <button onClick={fetchLogs} className="btn-primary">
            Refresh
          </button>
          <button onClick={exportCsv} className="btn-secondary">
            Export CSV
          </button>
        </div>
      </div>

      {/* Log Table */}
      <div className="glass-card p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 rounded-full animate-spin" />
          </div>
        ) : (
          <LogTable
            logs={logs}
            total={total}
            page={page}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}

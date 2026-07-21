"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { GuestVisit } from "@/types";
import CustomSelect from "@/components/CustomSelect";
import CustomDatePicker from "@/components/CustomDatePicker";

const emptyForm = {
  visitor_name: "",
  purpose: "",
  host_name: "",
  department: "",
  contact_number: "",
  valid_until: "",
  remarks: "",
};

export default function GuestVisitsPage() {
  const [visits, setVisits] = useState<GuestVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [autoCheckIn, setAutoCheckIn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState("");
  const [qrDirection, setQrDirection] = useState<"entry" | "exit">("exit");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [dateMode, setDateMode] = useState<string>("1day");

  const durationOptions = [
    { label: "1 Day", value: "1day" },
    { label: "3 Days", value: "3days" },
    { label: "1 Week", value: "1week" },
    { label: "1 Month", value: "1month" },
    { label: "Custom Date", value: "custom" },
  ];

  const updateValidUntil = useCallback((mode: string, customDate?: Date | null) => {
    let date = new Date();
    
    if (mode === "custom") {
      if (customDate) {
        date = customDate;
      } else {
        return; // Wait for user to pick a date
      }
    } else {
      switch (mode) {
        case "1day":
          date.setDate(date.getDate() + 1);
          break;
        case "3days":
          date.setDate(date.getDate() + 3);
          break;
        case "1week":
          date.setDate(date.getDate() + 7);
          break;
        case "1month":
          date.setMonth(date.getMonth() + 1);
          break;
      }
    }
    
    // Set to end of the day bounds for the selected date
    date.setHours(23, 59, 59, 999);
    setForm(prev => ({ ...prev, valid_until: date.toISOString().slice(0, 16) }));
  }, []);

  // Initialize the default 1day constraint on load
  useEffect(() => {
    if (!form.valid_until && dateMode !== "custom") {
      updateValidUntil(dateMode);
    }
  }, [dateMode, form.valid_until, updateValidUntil]);

  const visitorCheckInUrl = useMemo(() => {
    if (typeof window === "undefined") return "/visitor/check-in";
    return `${window.location.origin}/visitor/check-in`;
  }, []);

  const makeQrImageUrl = (payload: string, size = 180) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(payload)}`;

  const fetchVisits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/guest-visits?limit=100");
      const data = await res.json();
      setVisits(data.guest_visits || []);
    } catch (error) {
      console.error("Failed to fetch guest visits:", error);
      setMessage({ type: "error", text: "Failed to fetch guest visits" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVisits();
  }, [fetchVisits]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setLastToken(null);

    try {
      const res = await fetch("/api/guest-visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          auto_check_in: autoCheckIn,
          guard_in_name: "Guard Station",
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({
          type: "error",
          text: data.error || "Failed to create guest visit",
        });
        return;
      }

      setLastToken(data.qr_token || null);
      setMessage({
        type: "success",
        text: "Guest visit created. Save the visitor QR token below.",
      });
      setForm(emptyForm);
      setDateMode("1day");
      updateValidUntil("1day");
      await fetchVisits();
    } catch (error) {
      console.error("Failed to create guest visit:", error);
      setMessage({
        type: "error",
        text: "Network error while creating guest visit",
      });
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (
    visit: GuestVisit,
    action: "approve_entry" | "checkout" | "manual_checkout" | "cancel",
  ) => {
    try {
      const res = await fetch("/api/guest-visits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: visit.id,
          action,
          visitor_name: visit.visitor_name,
          guard_in_name: "Guard Station",
          guard_out_name: "Guard Station",
          has_details: Boolean(visit.visitor_name),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({
          type: "error",
          text: data.error || "Failed to update guest visit",
        });
        return;
      }
      setMessage({
        type: "success",
        text: `Guest visit updated: ${action.replace("_", " ")}`,
      });
      await fetchVisits();
    } catch (error) {
      console.error("Failed to update guest visit:", error);
      setMessage({
        type: "error",
        text: "Network error while updating guest visit",
      });
    }
  };

  const verifyGuestQr = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!qrToken.trim()) {
      setMessage({ type: "error", text: "QR token is required" });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/brain/qr-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qr_token: qrToken.trim(),
          direction: qrDirection,
          guard_name: "Guard Station",
          gate_id: "GATE-01",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.access === false) {
        setMessage({
          type: "error",
          text: data.message || data.error || "Guest QR denied",
        });
        return;
      }
      if (data.guest_visit_id) {
        await fetch("/api/guest-visits", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: data.guest_visit_id,
            action: qrDirection === "exit" ? "checkout" : "approve_entry",
            guard_in_name: "Guard Station",
            guard_out_name: "Guard Station",
          }),
        });
      }
      setQrToken("");
      setMessage({
        type: "success",
        text: data.message || "Guest QR accepted",
      });
      await fetchVisits();
    } catch (error) {
      console.error("Guest QR verify failed:", error);
      setMessage({
        type: "error",
        text: "Could not connect to local Brain API",
      });
    } finally {
      setSaving(false);
    }
  };

  const formatDateTime = (value: string | null) => {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  };

  const statusBadge = (status: string) => {
    if (status === "completed") return "badge-success";
    if (status.includes("inside")) return "badge-info";
    if (status === "cancelled") return "badge-danger";
    return "badge-warning";
  };

  const csvEscape = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };

  const exportCsv = () => {
    const header = [
      "visitor_name",
      "purpose",
      "host_name",
      "department",
      "contact_number",
      "status",
      "checked_in_at",
      "checked_out_at",
      "remarks",
    ];
    const rows = visits.map((visit) => [
      visit.visitor_name || "",
      visit.purpose || "",
      visit.host_name || "",
      visit.department || "",
      visit.contact_number || "",
      visit.status,
      visit.checked_in_at || "",
      visit.checked_out_at || "",
      visit.remarks || "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `guest-visits-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
          Guest Visits
        </h1>
        <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
          QR-based guest check-in, guard approval, and time-out monitoring.
        </p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl ${
            message.type === "success"
              ? "bg-success-50 dark:bg-success-950/40 border border-success-200 dark:border-success-800 text-success-700 dark:text-success-300"
              : "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="glass-card p-5 border-primary-300 dark:border-primary-700">
        <div className="flex flex-col md:flex-row gap-5 items-start">
          <div>
            <p className="text-sm text-surface-500 dark:text-surface-400 mb-2">
              Printed visitor check-in QR
            </p>
            <img
              src={makeQrImageUrl(visitorCheckInUrl, 160)}
              alt="Visitor check-in QR"
              className="rounded-xl bg-white dark:bg-surface-800 p-2"
            />
          </div>
          <div className="flex-1">
            <p className="text-surface-900 dark:text-white font-semibold">Public visitor form</p>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
              Print or display this QR at the guard area. It opens the visitor
              check-in form but does not open the gate.
            </p>
            <p className="font-mono text-xs break-all bg-surface-100 dark:bg-surface-900 rounded-lg p-3 border border-surface-300 dark:border-surface-700 mt-3">
              {visitorCheckInUrl}
            </p>
          </div>
        </div>
      </div>

      {lastToken && (
        <div className="glass-card p-5 border-primary-300 dark:border-primary-700">
          <div className="flex flex-col md:flex-row gap-5 items-start">
            <div>
              <p className="text-sm text-surface-500 dark:text-surface-400 mb-2">
                Temporary visitor pass QR
              </p>
              <img
                src={makeQrImageUrl(lastToken, 180)}
                alt="Temporary visitor pass QR"
                className="rounded-xl bg-white dark:bg-surface-800 p-2"
              />
            </div>
            <div className="flex-1">
              <p className="text-surface-900 dark:text-white font-semibold">
                Temporary visitor QR token
              </p>
              <p className="font-mono text-sm break-all bg-surface-100 dark:bg-surface-900 rounded-lg p-3 border border-surface-300 dark:border-surface-700 mt-2">
                {lastToken}
              </p>
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-2">
                This raw token is shown only once. Use the QR image or encode
                this token as the temporary visitor pass for exit scanning.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-5">Create Guest Visit</h2>
        <form onSubmit={handleCreate} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <div>
              <label className="input-label">Visitor Name</label>
              <input
                className="input-field"
                value={form.visitor_name}
                onChange={(e) =>
                  setForm({ ...form, visitor_name: e.target.value })
                }
                placeholder="Guest full name"
              />
            </div>
            <div>
              <label className="input-label">Purpose</label>
              <input
                className="input-field"
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="e.g., Parent visit"
              />
            </div>
            <div>
              <label className="input-label">Person/Office to Visit</label>
              <input
                className="input-field"
                value={form.host_name}
                onChange={(e) =>
                  setForm({ ...form, host_name: e.target.value })
                }
                placeholder="Office or host name"
              />
            </div>
            <div>
              <label className="input-label">Department/Office</label>
              <input
                className="input-field"
                value={form.department}
                onChange={(e) =>
                  setForm({ ...form, department: e.target.value })
                }
                placeholder="Department/office"
              />
            </div>
            <div>
              <label className="input-label">Contact Number</label>
              <input
                className="input-field"
                value={form.contact_number}
                onChange={(e) =>
                  setForm({ ...form, contact_number: e.target.value })
                }
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="input-label">Valid Duration / Date</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <CustomSelect
                    options={durationOptions}
                    value={durationOptions.find(o => o.value === dateMode) || durationOptions[0]}
                    onChange={(option) => {
                      const newMode = option?.value || "1day";
                      setDateMode(newMode);
                      if (newMode !== "custom") {
                        updateValidUntil(newMode);
                      }
                    }}
                    placeholder="Duration"
                  />
                </div>
                {dateMode === "custom" && (
                  <div className="flex-1">
                    <CustomDatePicker
                      selected={form.valid_until ? new Date(form.valid_until) : null}
                      onChange={(date) => updateValidUntil("custom", date)}
                      placeholder="Select date"
                      dateFormat="dd/MM/yyyy"
                    />
                  </div>
                )}
              </div>
              <span className="input-hint">
                {form.valid_until && `Expires end of day on ${new Date(form.valid_until).toLocaleDateString()}`}
              </span>
            </div>
          </div>
          <div>
            <label className="input-label">Remarks</label>
            <textarea
              className="input-field min-h-24"
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              placeholder="Optional notes"
            />
          </div>
          <label className="flex items-center gap-3 text-sm text-surface-600 dark:text-surface-300">
            <input
              type="checkbox"
              checked={autoCheckIn}
              onChange={(e) => setAutoCheckIn(e.target.checked)}
            />
            Guard approves entry immediately and records time-in
          </label>
          <button disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? "Creating..." : "Create Guest Visit"}
          </button>
        </form>
      </div>

      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-5">Scan Temporary Guest QR</h2>
        <form
          onSubmit={verifyGuestQr}
          className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-4 items-end"
        >
          <div>
            <label className="input-label">QR Token</label>
            <input
              className="input-field font-mono"
              value={qrToken}
              onChange={(e) => setQrToken(e.target.value)}
              placeholder="Paste/scanned guest QR token"
            />
          </div>
          <div>
            <label className="input-label">Direction</label>
            <CustomSelect
              options={[
                { label: "Entry", value: "entry" },
                { label: "Exit", value: "exit" }
              ]}
              value={qrDirection ? { label: qrDirection.charAt(0).toUpperCase() + qrDirection.slice(1), value: qrDirection } : null}
              onChange={(option) => setQrDirection((option?.value as "entry" | "exit") || "exit")}
              placeholder="Select direction"
            />
          </div>
          <button disabled={saving} className="btn-primary disabled:opacity-50">
            Verify QR
          </button>
        </form>
        <p className="text-xs text-surface-500 mt-3">
          This calls the local Brain API QR verification endpoint. Browser
          camera QR scanning can be connected to this same token field.
        </p>
      </div>

      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Recent Guest Visits</h2>
          <div className="flex gap-2">
            <button onClick={exportCsv} className="btn-secondary text-sm">
              Export CSV
            </button>
            <button onClick={fetchVisits} className="btn-secondary text-sm">
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 rounded-full animate-spin" />
          </div>
        ) : visits.length === 0 ? (
          <p className="text-surface-500 text-center py-12">
            No guest visits yet
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Visitor</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>Time In</th>
                  <th>Time Out</th>
                  <th>Host/Office</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((visit) => (
                  <tr key={visit.id}>
                    <td className="font-medium text-surface-900 dark:text-white">
                      {visit.visitor_name || "Pending details"}
                    </td>
                    <td className="text-surface-500 dark:text-surface-400 text-sm">
                      {visit.purpose || "—"}
                    </td>
                    <td>
                      <span className={`badge ${statusBadge(visit.status)}`}>
                        {visit.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="text-surface-500 dark:text-surface-400 text-sm whitespace-nowrap">
                      {formatDateTime(visit.checked_in_at)}
                    </td>
                    <td className="text-surface-500 dark:text-surface-400 text-sm whitespace-nowrap">
                      {formatDateTime(visit.checked_out_at)}
                    </td>
                    <td className="text-surface-500 dark:text-surface-400 text-sm">
                      {visit.host_name || visit.department || "—"}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {visit.status === "pending_approval" && (
                          <button
                            onClick={() => runAction(visit, "approve_entry")}
                            className="btn-primary text-xs py-1.5 px-3"
                          >
                            Approve Entry
                          </button>
                        )}
                        {visit.status.includes("inside") && (
                          <button
                            onClick={() => runAction(visit, "checkout")}
                            className="btn-secondary text-xs py-1.5 px-3"
                          >
                            Check Out
                          </button>
                        )}
                        {visit.status !== "completed" &&
                          visit.status !== "cancelled" && (
                            <button
                              onClick={() => runAction(visit, "cancel")}
                              className="btn-danger text-xs py-1.5 px-3"
                            >
                              Cancel
                            </button>
                          )}
                      </div>
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

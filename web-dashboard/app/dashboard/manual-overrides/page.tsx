"use client";

import { FormEvent, useState } from "react";
import CustomSelect from "@/components/CustomSelect";

export default function ManualOverridesPage() {
  const [direction, setDirection] = useState<"entry" | "exit">("entry");
  const [operatorName, setOperatorName] = useState("Guard Station");
  const [reason, setReason] = useState("Authorized manual gate opening");
  const [gateId, setGateId] = useState("GATE-01");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/manual-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          operator_name: operatorName,
          reason,
          gate_id: gateId,
          source: "dashboard",
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Failed to record manual override" });
        return;
      }

      setMessage({ type: "success", text: "Manual override recorded in access logs." });
    } catch (error) {
      console.error("Manual override error:", error);
      setMessage({ type: "error", text: "Network error while recording manual override" });
    } finally {
      setSaving(false);
    }
  };

  const triggerLocalBrain = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/brain/manual-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          operator_name: operatorName,
          reason,
          gate_id: gateId,
          source: "dashboard",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Brain API manual override failed" });
        return;
      }
      setMessage({
        type: "success",
        text: data.gate_triggered
          ? "Local manual override logged and gate triggered."
          : "Local manual override logged. Gate trigger is disabled in Brain API config.",
      });
    } catch (error) {
      console.error("Brain manual override error:", error);
      setMessage({ type: "error", text: "Could not connect to local Brain API" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
          Manual Override
        </h1>
        <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
          Record guard-approved manual openings for entry or exit.
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

      <div className="glass-card p-6 max-w-3xl">
        <h2 className="text-lg font-semibold mb-5">Manual Gate Opening Record</h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="input-label">Direction</label>
              <CustomSelect
                options={[
                  { label: "Entry", value: "entry" },
                  { label: "Exit", value: "exit" }
                ]}
                value={direction ? { label: direction.charAt(0).toUpperCase() + direction.slice(1), value: direction } : null}
                onChange={(option) => setDirection((option?.value as "entry" | "exit") || "entry")}
                placeholder="Select direction"
              />
            </div>
            <div>
              <label className="input-label">Gate ID</label>
              <input
                className="input-field"
                value={gateId}
                onChange={(e) => setGateId(e.target.value)}
              />
            </div>
            <div>
              <label className="input-label">Guard/Operator Name</label>
              <input
                className="input-field"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
              />
            </div>
            <div>
              <label className="input-label">Reason</label>
              <input
                className="input-field"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Saving..." : "Record Cloud Manual Override"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={triggerLocalBrain}
              className="btn-secondary disabled:opacity-50"
            >
              Trigger Local Brain API
            </button>
          </div>
        </form>

        <p className="text-xs text-surface-500 mt-4">
          Cloud recording inserts a manual access log in Supabase. Local Brain API trigger records the event locally and can open the gate only when BRAIN_API_GATE_CONTROL_ENABLED is enabled on the gate device.
        </p>
      </div>
    </div>
  );
}

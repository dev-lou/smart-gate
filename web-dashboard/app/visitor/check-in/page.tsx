"use client";

import { FormEvent, useState } from "react";

const emptyForm = {
  visitor_name: "",
  purpose: "",
  host_name: "",
  department: "",
  contact_number: "",
};

export default function VisitorCheckInPage() {
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [referenceId, setReferenceId] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/guest-visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          auto_check_in: false,
          status: "pending_approval",
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to submit visitor check-in");
        return;
      }

      setReferenceId(data.guest_visit?.id || "");
      setSubmitted(true);
      setForm(emptyForm);
    } catch {
      setError("Network error. Please ask the guard for assistance.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <main className="min-h-screen bg-surface-100 dark:bg-surface-950 flex items-center justify-center p-6">
        <div className="glass-card dark:bg-surface-800 dark:border-surface-700 max-w-lg w-full p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Check-in Submitted</h1>
          <p className="text-surface-500 dark:text-surface-400">
            Please wait for the guard to verify and approve your entry.
          </p>
          {referenceId && (
            <p className="text-xs text-surface-500 dark:text-surface-400 break-all">
              Reference: {referenceId}
            </p>
          )}
          <button onClick={() => setSubmitted(false)} className="btn-primary">
            Submit Another Visitor
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface-100 dark:bg-surface-950 flex items-center justify-center p-6">
      <div className="glass-card dark:bg-surface-800 dark:border-surface-700 max-w-2xl w-full p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-surface-900 dark:text-white">
            Visitor Check-In
          </h1>
          <p className="text-surface-500 dark:text-surface-400 text-sm mt-2">
            Fill out this form, then wait for guard approval at the gate.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="input-label">Full Name *</label>
            <input
              className="input-field"
              value={form.visitor_name}
              onChange={(e) => setForm({ ...form, visitor_name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="input-label">Purpose of Visit *</label>
            <input
              className="input-field"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="input-label">Person/Office to Visit</label>
              <input
                className="input-field"
                value={form.host_name}
                onChange={(e) => setForm({ ...form, host_name: e.target.value })}
              />
            </div>
            <div>
              <label className="input-label">Department/Office</label>
              <input
                className="input-field"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="input-label">Contact Number</label>
            <input
              className="input-field"
              value={form.contact_number}
              onChange={(e) => setForm({ ...form, contact_number: e.target.value })}
            />
          </div>
          <button disabled={loading} className="btn-primary w-full disabled:opacity-50">
            {loading ? "Submitting..." : "Submit Visitor Check-In"}
          </button>
        </form>
      </div>
    </main>
  );
}

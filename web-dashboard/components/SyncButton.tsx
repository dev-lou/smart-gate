"use client";

import { useState } from "react";

interface SyncButtonProps {
  apiUrl?: string;
}

export default function SyncButton({ apiUrl = "/api/settings" }: SyncButtonProps) {
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const triggerSync = async () => {
    setSyncing(true);
    setLastResult(null);

    try {
      const response = await fetch(apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "sync_required", value: "true" }),
      });

      if (response.ok) {
        setLastResult("Sync signal sent! Pi will sync on next check.");
      } else {
        setLastResult("Failed to trigger sync.");
      }
    } catch {
      setLastResult("Network error. Could not reach server.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={triggerSync}
        disabled={syncing}
        className={`btn-success disabled:opacity-50 ${syncing ? "sync-pulse" : ""}`}
      >
        {syncing ? (
          <>
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Syncing...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Sync Now
          </>
        )}
      </button>
      {lastResult && (
        <span className="text-sm text-surface-500 dark:text-surface-400 animate-fade-in">{lastResult}</span>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/ToastProvider";
import {
  Settings,
  Save,
  CheckCircle2,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────

interface Setting {
  key: string;
  value: string;
  description: string | null;
}

// Keys the system actually uses (kiosk reads these from system_settings)
const SETTING_META: Record<
  string,
  {
    label: string;
    type: "text" | "number" | "boolean";
    description: string;
    min?: number;
    max?: number;
    step?: number;
  }
> = {
  school_name: {
    label: "School Name (Branding)",
    type: "text",
    description:
      "Institution name shown in navbars & titles across all apps — dashboard, guard, and kiosk.",
  },
  school_initials: {
    label: "School Initials (Logo Badge)",
    type: "text",
    description:
      "Short initials shown in the logo badge everywhere, and spoken in the kiosk welcome message (e.g., ISUFST).",
  },
  face_recognition_threshold: {
    label: "Face Match Threshold",
    type: "number",
    description:
      "Minimum cosine similarity (0-1) the kiosk needs before it accepts a face. Higher = stricter (fewer false accepts, more false rejects); lower = more permissive. 0.7 is the recommended default — the kiosk additionally requires 5 consecutive matching reads (~2.5s of holding still) plus a clear margin over the next-closest profile, so a stranger is shown as Unknown instead of a wrong name.",
    min: 0.3,
    max: 0.9,
    step: 0.05,
  },    lockdown_mode: {
      label: "Campus Lockdown",
      type: "boolean",
      description: "When ON the kiosk denies everyone with LOCKDOWN_ACTIVE. Guard override with reason still logs.",
    },
    lockdown_reason: {
      label: "Lockdown Reason",
      type: "text",
      description: "Shown on kiosk + logs while lockdown is ON (e.g. Emergency drill 2PM).",
    },
  gate_open_duration: {
    label: "Gate Open Duration (seconds)",
    type: "number",
    description: "How long the gate stays open after access is granted.",
    min: 1,
    max: 30,
    step: 1,
  },
  sync_interval_minutes: {
    label: "Kiosk Sync Interval (minutes)",
    type: "number",
    description: "How often each kiosk refreshes students & settings from the cloud.",
    min: 5,
    max: 1440,
    step: 5,
  },
  voice_enabled: {
    label: "Voice Announcements",
    type: "boolean",
    description:
      'Kiosk audio: welcome chime + "Welcome to <initials>" on grant, denial and override cues.',
  },
};

const KNOWN_KEYS = Object.keys(SETTING_META);
export default function SettingsPage() {
  const router = useRouter();
  const { pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Setting[]>([]);

  const loadAll = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;

    const settingsRes = await supabase.from("system_settings").select("key, value, description");

    if (settingsRes.error) {
      pushToast("error", `Settings: ${settingsRes.error.message}`);
    } else {
      setSettings(settingsRes.data ?? []);
    }
    setLoading(false);
  }, [pushToast]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      router.push("/login");
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
        return;
      }
      void loadAll();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── System settings ─────────────────────────────────

  const knownSettings = useMemo(
    () => settings.filter((s) => KNOWN_KEYS.includes(s.key)),
    [settings],
  );
  const orphanKeys = useMemo(
    () => settings.filter((s) => !KNOWN_KEYS.includes(s.key)),
    [settings],
  );

  function updateSetting(key: string, value: string) {
    setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));
  }

  async function saveSettings() {
    setSaving(true);
    const supabase = getSupabase();
    if (!supabase) return;

    const updates = knownSettings.map((s) => ({ key: s.key, value: s.value }));
    const { error } = await supabase.from("system_settings").upsert(updates, {
      onConflict: "key",
    });
    if (error) {
      pushToast("error", error.message);
    } else {
      pushToast("success", "System settings saved — kiosks pick this up on their next sync");
    }
    setSaving(false);
  }

  // ─── Render ──────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black text-surface-900 tracking-tight">
            Settings
          </h1>
          <p className="text-surface-500 font-medium text-sm mt-1">
            Gate behavior, recognition tuning, lockdown, and guest-pass policy
          </p>
        </div>
        <button
          onClick={saveSettings}
          disabled={saving}
          className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      {loading ? (
        <div className="text-center text-surface-500 font-medium py-12">Loading settings...</div>
      ) : (
        <div className="space-y-8">
          {/* ─── 1. Gate & Recognition ─── */}
          <section className="bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-100 bg-surface-50/50 flex items-center gap-2.5">
              <SlidersHorizontal className="w-4 h-4 text-primary-600" />
              <h2 className="font-bold text-surface-900 text-sm">System & Gate</h2>
              <p className="text-xs text-surface-400 font-medium ml-auto hidden sm:block">
                Read by every kiosk on sync
              </p>
            </div>
            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
              {knownSettings.map((setting) => {
                const meta = SETTING_META[setting.key];
                if (meta.type === "boolean") {
                  const enabled = setting.value === "true";
                  return (
                    <div key={setting.key} className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-bold text-surface-900 text-sm">{meta.label}</p>
                        <p className="text-xs text-surface-500 font-medium mt-0.5">
                          {meta.description}
                        </p>
                      </div>
                      <button
                        onClick={() => updateSetting(setting.key, enabled ? "false" : "true")}
                        className={`relative w-12 h-7 rounded-full transition-colors shrink-0 cursor-pointer ${
                          enabled ? "bg-green-600" : "bg-surface-300"
                        }`}
                        aria-label={meta.label}
                      >
                        <span
                          className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${
                            enabled ? "left-[22px]" : "left-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={setting.key}>
                    <label className="block font-bold text-surface-900 text-sm mb-1">
                      {meta.label}
                    </label>
                    <p className="text-xs text-surface-500 font-medium mb-3">{meta.description}</p>
                    <input
                      type={meta.type === "number" ? "number" : "text"}
                      value={setting.value}
                      min={meta.min}
                      max={meta.max}
                      step={meta.step}
                      onChange={(e) => updateSetting(setting.key, e.target.value)}
                      className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-surface-900 font-medium focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors"
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {/* ─── 4. Advanced (non-editable) ─── */}
          {orphanKeys.length > 0 && (
            <section className="bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-surface-100 bg-surface-50/50 flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-surface-500" />
                <h2 className="font-bold text-surface-900 text-sm">Managed Internally</h2>
              </div>
              <div className="p-6">
                <p className="text-sm text-surface-500 font-medium mb-4">
                  These settings are managed automatically by the system and shouldn't be edited
                  here.
                </p>
                <div className="flex flex-wrap gap-2">
                  {orphanKeys.map((s) => (
                    <span
                      key={s.key}
                      className="px-3 py-1.5 rounded-xl bg-surface-50 border border-surface-200 text-xs font-mono font-semibold text-surface-600"
                    >
                      {s.key}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ─── System info ─── */}
          <section className="bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-100 bg-surface-50/50 flex items-center gap-2.5">
              <Settings className="w-4 h-4 text-surface-500" />
              <h2 className="font-bold text-surface-900 text-sm">Deployment Info</h2>
            </div>
            <div className="p-6 flex flex-wrap gap-3">
              <div className="px-4 py-3 rounded-xl bg-surface-50 border border-surface-200 text-xs font-semibold text-surface-600 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                AI Models: face bundled on kiosk (offline)
              </div>
              <div className="px-4 py-3 rounded-xl bg-surface-50 border border-surface-200 text-xs font-semibold text-surface-600 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Changes reach kiosks on their next sync (default 60 min) or Force Sync
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

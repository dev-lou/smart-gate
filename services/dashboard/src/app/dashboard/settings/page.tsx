"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

interface Setting {
  key: string;
  value: string;
  description: string | null;
}

const SETTING_META: Record<string, { label: string; type: string; options?: string[] }> = {
  school_name: { label: "School Name", type: "text" },
  face_recognition_threshold: { label: "Face Match Threshold", type: "number" },
  uniform_detection_enabled: {
    label: "Enable Uniform Detection",
    type: "select",
    options: ["true", "false"],
  },
  gate_open_duration: { label: "Gate Open Duration (seconds)", type: "number" },
  sync_interval_minutes: { label: "Sync Interval (minutes)", type: "number" },
};

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      router.push("/login");
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.push("/login");
    });
  }, [router]);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const supabase = getSupabase();
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase.from("system_settings").select("*");
    if (data) setSettings(data);
    setLoading(false);
  }

  async function updateSetting(key: string, value: string) {
    setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));
  }

  async function saveSettings() {
    const supabase = getSupabase();
    if (!supabase) return;

    setSaving(true);
    setMessage("");

    const updates = settings.map((s) => ({
      key: s.key,
      value: s.value,
    }));

    const { error } = await supabase.from("system_settings").upsert(updates, {
      onConflict: "key",
    });

    if (error) {
      setMessage(`Error: ${error.message}`);
    } else {
      setMessage("Settings saved successfully!");
      setTimeout(() => setMessage(""), 3000);
    }

    setSaving(false);
  }

  return (
    <div className="min-h-screen bg-surface-950 p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">⚙️ Settings</h1>
          <p className="text-surface-400 text-sm mt-1">System configuration</p>
        </div>
        <button
          onClick={saveSettings}
          disabled={saving}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {saving ? "Saving..." : "💾 Save Settings"}
        </button>
      </div>

      {message && (
        <div
          className={`mb-6 px-4 py-3 rounded-xl text-sm ${
            message.startsWith("Error")
              ? "bg-red-500/10 text-red-400"
              : "bg-green-500/10 text-green-400"
          }`}
        >
          {message}
        </div>
      )}

      {loading ? (
        <div className="text-center text-surface-400 py-12">Loading settings...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {settings
            .filter((s) => SETTING_META[s.key])
            .map((setting) => {
              const meta = SETTING_META[setting.key];
              return (
                <div key={setting.key} className="glass-card p-6">
                  <label className="block font-semibold text-white mb-1">{meta.label}</label>
                  <p className="text-xs text-surface-400 mb-3">{setting.description || ""}</p>

                  {meta.type === "select" ? (
                    <select
                      value={setting.value}
                      onChange={(e) => updateSetting(setting.key, e.target.value)}
                      className="input-field"
                    >
                      {meta.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={meta.type}
                      value={setting.value}
                      onChange={(e) => updateSetting(setting.key, e.target.value)}
                      className="input-field"
                      step={meta.type === "number" ? "0.1" : undefined}
                    />
                  )}

                  <p className="text-xs text-surface-500 mt-2 font-mono">{setting.key}</p>
                </div>
              );
            })}
        </div>
      )}

      {settings.filter((s) => !SETTING_META[s.key]).length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-white mb-4">Other Settings</h2>
          <div className="glass-card p-6">
            {settings
              .filter((s) => !SETTING_META[s.key])
              .map((s) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between py-3 border-b border-surface-800/50 last:border-0"
                >
                  <div>
                    <p className="text-white text-sm font-medium">{s.key}</p>
                    {s.description && <p className="text-surface-400 text-xs">{s.description}</p>}
                  </div>
                  <input
                    type="text"
                    value={s.value}
                    onChange={(e) => updateSetting(s.key, e.target.value)}
                    className="w-48 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-white text-sm focus:border-primary-500 focus:outline-none"
                  />
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

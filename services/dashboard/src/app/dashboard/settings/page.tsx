"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { Settings, Save, AlertCircle, CheckCircle2 } from "lucide-react";

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
    setLoading(true);
    const supabase = getSupabase();
    let loadedSettings = null;

    if (supabase) {
      try {
        const { data } = await supabase.from("system_settings").select("*");
        loadedSettings = data;
      } catch (err) {}
    }

    if (loadedSettings && loadedSettings.length > 0) {
      setSettings(loadedSettings);
    } else {
      // Mock data for UI preview
      setSettings([
        { key: "school_name", value: "Smart Gate University", description: "Name displayed on kiosk" },
        { key: "face_recognition_threshold", value: "0.85", description: "Minimum confidence score (0.0 to 1.0)" },
        { key: "uniform_detection_enabled", value: "true", description: "Toggle AI uniform detection" },
        { key: "gate_open_duration", value: "5", description: "Seconds the gate remains open" },
        { key: "sync_interval_minutes", value: "15", description: "How often to sync with cloud" },
      ]);
    }
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
    <div className="min-h-screen p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-surface-200 flex items-center justify-center">
            <Settings className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-900">Settings</h1>
            <p className="text-surface-500 font-medium text-sm mt-1">System configuration</p>
          </div>
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

      {message && (
        <div
          className={`mb-6 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2 ${
            message.startsWith("Error")
              ? "bg-red-50 border border-red-200 text-red-700"
              : "bg-green-50 border border-green-200 text-green-700"
          }`}
        >
          {message.startsWith("Error") ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          {message}
        </div>
      )}

      {loading ? (
        <div className="text-center text-surface-500 font-medium py-12">Loading settings...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {settings
            .filter((s) => SETTING_META[s.key])
            .map((setting) => {
              const meta = SETTING_META[setting.key];
              return (
                <div key={setting.key} className="bg-white rounded-2xl shadow-sm border border-surface-200 p-6">
                  <label className="block font-bold text-surface-900 mb-1">{meta.label}</label>
                  <p className="text-xs font-medium text-surface-500 mb-4">{setting.description || ""}</p>

                  {meta.type === "select" ? (
                    <select
                      value={setting.value}
                      onChange={(e) => updateSetting(setting.key, e.target.value)}
                      className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-surface-900 font-medium focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors"
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
                      className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-surface-900 font-medium focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors"
                      step={meta.type === "number" ? "0.1" : undefined}
                    />
                  )}

                  <p className="text-xs text-surface-400 font-medium mt-3 font-mono">{setting.key}</p>
                </div>
              );
            })}
        </div>
      )}

      {settings.filter((s) => !SETTING_META[s.key]).length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-surface-900 mb-4">Other Settings</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden p-6">
            {settings
              .filter((s) => !SETTING_META[s.key])
              .map((s) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between py-3 border-b border-surface-100 last:border-0"
                >
                  <div>
                    <p className="text-surface-900 text-sm font-bold">{s.key}</p>
                    {s.description && <p className="text-surface-500 font-medium text-xs">{s.description}</p>}
                  </div>
                  <input
                    type="text"
                    value={s.value}
                    onChange={(e) => updateSetting(s.key, e.target.value)}
                    className="w-48 px-3 py-2 bg-surface-50 border border-surface-200 rounded-lg text-surface-900 font-medium text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  />
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

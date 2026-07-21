"use client";

import { useEffect, useState, useCallback } from "react";
import { SystemSetting } from "@/types";
import SyncButton from "@/components/SyncButton";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [gateConfig, setGateConfig] = useState({ idle_image_url: "" });
  const [savingGate, setSavingGate] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/settings?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      const settingsList = data.settings || [];
      setSettings(settingsList);

      const values: Record<string, string> = {};
      settingsList.forEach((s: SystemSetting) => {
        values[s.key] = s.value;
      });
      setEditValues(values);

      setGateConfig({
        idle_image_url: values["idle_image_url"] || "",
      });
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveGateConfig = async () => {
    setSavingGate(true);
    setMessage(null);
    try {
      const payload = [
        { key: "idle_image_url", value: gateConfig.idle_image_url.trim() },
      ];
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: payload }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Gate configuration saved." });
        fetchSettings();
      } else {
        setMessage({ type: "error", text: "Failed to save gate configuration." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setSavingGate(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const settingsToUpdate = settings
        .filter((s) => editValues[s.key] !== s.value)
        .map((s) => ({
          key: s.key,
          value: editValues[s.key],
        }));

      if (settingsToUpdate.length === 0) {
        setMessage({ type: "info", text: "No changes to save." });
        setSaving(false);
        return;
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: settingsToUpdate }),
      });

      if (res.ok) {
        setMessage({ type: "success", text: `${settingsToUpdate.length} setting(s) updated!` });
        fetchSettings();
      } else {
        setMessage({ type: "error", text: "Failed to save settings" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  // Group settings for display
  const getSettingLabel = (key: string): string => {
    const labels: Record<string, string> = {
      school_name: "School Name",
      brain_api_url: "Brain API URL",
      idle_image_url: "Idle Image URL (Gate)",
      face_recognition_threshold: "Face Recognition Threshold",
      uniform_detection_enabled: "Uniform Detection Enabled",
      uniform_min_area_ratio: "Min. Uniform Area Ratio",
      sync_interval_minutes: "Sync Interval (minutes)",
      sync_required: "Sync Required (flag)",
      gate_open_duration: "Gate Open Duration (seconds)",
      yolo_model_path: "YOLO Model Path",
    };
    return labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const getInputType = (key: string): string => {
    if (key.includes("enabled") || key.includes("required") || key === "sync_required") {
      return "toggle";
    }
    if (key.includes("threshold") || key.includes("ratio") || key.includes("duration") || key.includes("interval")) {
      return "number";
    }
    return "text";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
            System Settings
          </h1>
          <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
            Configure gate system parameters
          </p>
        </div>
        <SyncButton />
      </div>

      {/* Messages */}
      {message && (
        <div
          className={`p-4 rounded-xl animate-slide-up ${
            message.type === "success"
              ? "bg-success-50 dark:bg-success-950/40 border border-success-200 dark:border-success-800 text-success-700 dark:text-success-300"
              : message.type === "error"
              ? "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
              : "bg-primary-50 dark:bg-primary-950/40 border border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        {/* Gate Configuration */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-bold mb-4">Advanced Configuration</h2>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-5">
                {settings
                .filter((s) => !["sync_required", "brain_api_url", "idle_image_url", "yolo_model_path", "fingerprint_requires_uniform", "uniform_color_lower", "uniform_color_upper", "uniform_min_area_ratio", "department_uniform_policies"].includes(s.key) && !s.key.startsWith('uniform_ref_'))
                .map((setting) => {
                    const inputType = getInputType(setting.key);
                    return (
                    <div key={setting.id} className="flex flex-col md:flex-row md:items-center gap-3 py-3 border-b border-surface-300 dark:border-surface-700 last:border-0">
                        <div className="md:w-1/3">
                        <label htmlFor={`setting-${setting.key}`} className="font-medium text-sm text-surface-900 dark:text-white">
                            {getSettingLabel(setting.key)}
                        </label>
                        {setting.description && (
                            <p className="text-surface-600 dark:text-surface-400 text-xs mt-0.5">{setting.description}</p>
                        )}
                        </div>
                        <div className="md:w-2/3">
                        {inputType === "toggle" ? (
                            <button
                            id={`setting-${setting.key}`}
                            onClick={() =>
                                setEditValues({
                                ...editValues,
                                [setting.key]: editValues[setting.key] === "true" ? "false" : "true",
                                })
                            }
                            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                                editValues[setting.key] === "true"
                                ? "bg-success-500"
                                : "bg-surface-300 dark:bg-surface-700"
                            }`}
                            >
                            <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                                editValues[setting.key] === "true" ? "translate-x-6" : "translate-x-1"
                                }`}
                            />
                            </button>
                        ) : (
                            <input
                            id={`setting-${setting.key}`}
                            type={inputType === "number" ? "number" : "text"}
                            step={inputType === "number" ? "any" : undefined}
                            className="input-field max-w-md"
                            value={editValues[setting.key] || ""}
                            onChange={(e) =>
                                setEditValues({ ...editValues, [setting.key]: e.target.value })
                            }
                            />
                        )}
                        </div>
                    </div>
                    );
                })}

                <div className="flex justify-end pt-4">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="btn-primary disabled:opacity-50"
                >
                    {saving ? "Saving..." : "Save Settings"}
                </button>
                </div>
            </div>
            )}
        </div>
      </div>
    </div>
  );
}

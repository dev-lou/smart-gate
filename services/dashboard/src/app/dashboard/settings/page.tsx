"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/ToastProvider";
import {
  Settings,
  Save,
  CheckCircle2,
  Palette,
  BookOpen,
  GraduationCap,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────

interface Setting {
  key: string;
  value: string;
  description: string | null;
}

interface UniformType {
  id: string;
  name: string;
  description: string | null;
  class_id: number;
  color_hex: string | null;
  is_active: boolean;
}

interface CourseUniform {
  id: string;
  course: string;
  uniform_name: string;
  uniform_description: string | null;
  class_id: number;
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
      "Minimum cosine similarity (0-1) the kiosk needs before it accepts a face. Higher = stricter (fewer false accepts, more false rejects); lower = more permissive. 0.4-0.5 works well in a dim lobby; raise it if the kiosk ever greets the wrong person.",
    min: 0.3,
    max: 0.9,
    step: 0.05,
  },
  uniform_detection_enabled: {
    label: "Uniform Detection",
    type: "boolean",
    description: "Enforce uniform checking at the gate before granting access.",
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
const COURSES = ["CBMSD", "CICI", "COAG", "Education"];

function formatUniformLabel(u: string): string {
  if (!u || u === "default") return "Standard";
  return u
    .replace(/^(cici_|cbmsd_|coag_|edu_|education_)/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SettingsPage() {
  const router = useRouter();
  const { pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [uniforms, setUniforms] = useState<UniformType[]>([]);
  const [mappings, setMappings] = useState<CourseUniform[]>([]);

  const loadAll = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;

    const [settingsRes, uniformsRes, mappingsRes] = await Promise.all([
      supabase.from("system_settings").select("key, value, description"),
      supabase.from("uniform_types").select("*").order("class_id", { ascending: true }),
      supabase
        .from("course_uniforms")
        .select(`id, course, uniform_type_id, uniform_types!inner(name, description, class_id)`),
    ]);

    if (settingsRes.error) {
      pushToast("error", `Settings: ${settingsRes.error.message}`);
    } else {
      setSettings(settingsRes.data ?? []);
    }
    if (uniformsRes.error) {
      pushToast("error", `Uniforms: ${uniformsRes.error.message}`);
    } else {
      setUniforms(uniformsRes.data ?? []);
    }
    if (mappingsRes.error) {
      pushToast("error", `Mappings: ${mappingsRes.error.message}`);
    } else {
      setMappings(
        (mappingsRes.data ?? []).map((m: any) => ({
          id: m.id,
          course: m.course,
          uniform_name: m.uniform_types.name,
          uniform_description: m.uniform_types.description,
          class_id: m.uniform_types.class_id,
        })),
      );
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
    () => settings.filter((s) => !KNOWN_KEYS.includes(s.key) && s.key !== "uniform_class_names"),
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
            Gate behavior, recognition tuning, and uniform enforcement
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

          {/* ─── 2. Uniform Types (READ-ONLY — tied to the trained model) ─── */}
          <section className="bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-100 bg-surface-50/50 flex items-center gap-2.5">
              <Palette className="w-4 h-4 text-primary-600" />
              <h2 className="font-bold text-surface-900 text-sm">Uniform Types</h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-primary-50 text-primary-700 border border-primary-100">
                {uniforms.length} classes
              </span>
              <p className="text-xs text-surface-400 font-medium ml-auto hidden sm:block">
                Fixed by the trained YOLO model — managed manually, not editable here
              </p>
            </div>
            <div className="p-6">
              <p className="text-sm text-surface-500 font-medium mb-4 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-green-600 shrink-0" />
                These classes come from your trained model. Adding or renaming them in this app
                wouldn't change what the model can detect — so they're shown here for reference
                only.
              </p>
              {uniforms.length === 0 ? (
                <div className="p-8 bg-surface-50 rounded-xl text-center text-sm font-medium text-surface-400 border border-dashed border-surface-200">
                  No uniform types found — run the uniform migration in your Supabase SQL editor.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {uniforms.map((u) => (
                    <div
                      key={u.id}
                      className={`border rounded-2xl p-4 transition-colors ${
                        u.is_active
                          ? "border-surface-200"
                          : "border-surface-200 bg-surface-50 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-6 h-6 rounded-lg border border-black/10 shrink-0"
                            style={{ backgroundColor: u.color_hex || "#6366f1" }}
                          />
                          <div>
                            <p className="font-bold text-surface-900 text-sm">
                              {u.description || formatUniformLabel(u.name)}
                            </p>
                            <p className="text-[10px] font-mono font-semibold text-surface-400">
                              {u.name}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-surface-100 text-surface-600 text-[10px] font-black">
                          Class {u.class_id}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                            u.is_active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                          }`}
                        >
                          {u.is_active ? "ACTIVE" : "DISABLED"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ─── 3. Course → Uniform Assignment (READ-ONLY) ─── */}
          <section className="bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-100 bg-surface-50/50 flex items-center gap-2.5">
              <GraduationCap className="w-4 h-4 text-primary-600" />
              <h2 className="font-bold text-surface-900 text-sm">Course Uniform Assignment</h2>
              <p className="text-xs text-surface-400 font-medium ml-auto hidden sm:block">
                Which uniforms each course is allowed to wear
              </p>
            </div>
            <div className="p-6">
              <p className="text-sm text-surface-500 font-medium mb-4 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary-600 shrink-0" />
                At the kiosk, a student's course is matched against the uniform they're wearing —
                any uniform of the same course counts (e.g. CICI blazer/female/male all verify a
                CICI student). This mapping is maintained with your training data.
              </p>
              {mappings.length === 0 ? (
                <div className="p-8 bg-surface-50 rounded-xl text-center text-sm font-medium text-surface-400 border border-dashed border-surface-200">
                  No course assignments yet — set them up in your Supabase SQL editor.
                </div>
              ) : (
                <div className="space-y-4">
                  {COURSES.map((course) => {
                    const courseMappings = mappings.filter(
                      (m) => m.course.toUpperCase() === course.toUpperCase(),
                    );
                    if (courseMappings.length === 0) return null;
                    return (
                      <div key={course} className="border border-surface-100 rounded-2xl p-4">
                        <p className="text-xs font-black uppercase tracking-wider text-surface-500 mb-3 flex items-center gap-2">
                          <BookOpen className="w-3.5 h-3.5 text-primary-500" />
                          {course}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {courseMappings.map((m) => (
                            <span
                              key={m.id}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-50 border border-surface-200 text-xs font-bold text-surface-700"
                            >
                              {m.uniform_description || formatUniformLabel(m.uniform_name)}
                              <span className="text-[10px] font-black text-surface-400">
                                cls {m.class_id}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {mappings.filter(
                    (m) => !COURSES.some((c) => c.toUpperCase() === m.course.toUpperCase()),
                  ).length > 0 && (
                    <div className="border border-amber-200 bg-amber-50/50 rounded-2xl p-4">
                      <p className="text-xs font-black uppercase tracking-wider text-amber-700 mb-3 flex items-center gap-2">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Other courses
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {mappings
                          .filter(
                            (m) => !COURSES.some((c) => c.toUpperCase() === m.course.toUpperCase()),
                          )
                          .map((m) => (
                            <span
                              key={m.id}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-amber-200 text-xs font-bold text-surface-700"
                            >
                              {m.course}:{" "}
                              {m.uniform_description || formatUniformLabel(m.uniform_name)}
                            </span>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
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
                AI Models: face + uniform bundled on kiosk (offline)
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

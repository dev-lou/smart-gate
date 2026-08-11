"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { Shield, Camera, Image as ImageIcon, CameraIcon, RefreshCw, X, AlertTriangle, Lightbulb, CheckCircle2, XCircle, LayoutDashboard, ScreenShare, Lock, UserPlus, ClipboardList, Zap } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────

interface CourseUniform {
  course: string;
  uniform_type_id: string;
  uniform_name: string;
  uniform_description: string;
}

interface Course {
  value: string;
  label: string;
}

const COURSES: Course[] = [
  { value: "BSIT", label: "BS Information Technology" },
  { value: "BSHM", label: "BS Hospitality Management" },
  { value: "COAGRI", label: "BS Agriculture" },
  { value: "Education", label: "Bachelor of Education" },
];

const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const SECTIONS = ["A", "B", "C", "D"];

// 🔴 ACCURACY FIX #4: Define the 3 photo angles for enrollment
const PHOTO_ANGLES = [
  {
    id: "front",
    label: "Front",
    icon: <UserPlus className="w-6 h-6 text-primary-500" />,
    instruction: "Look straight at the camera",
    tip: "Face forward, natural expression",
  },
  {
    id: "left",
    label: "Left 45°",
    icon: <Camera className="w-6 h-6 text-primary-500" />,
    instruction: "Turn head slightly to the left",
    tip: "About 45-degree angle",
  },
  {
    id: "right",
    label: "Right 45°",
    icon: <Camera className="w-6 h-6 text-primary-500" />,
    instruction: "Turn head slightly to the right",
    tip: "About 45-degree angle",
  },
] as const;

type PhotoAngle = (typeof PHOTO_ANGLES)[number];

interface PhotoSlot {
  angle: PhotoAngle;
  file: File | null;
  preview: string | null;
  capturing: boolean;
}

// ─── Types ──────────────────────────────────────────────────

interface EnrollmentForm {
  name: string;
  student_id: string;
  course: string;
  year: string;
  section: string;
}

interface SyncStatus {
  status: "idle" | "syncing" | "success" | "error";
  message: string;
}

// ─── Component ──────────────────────────────────────────────

export default function GuardPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [form, setForm] = useState<EnrollmentForm>({
    name: "",
    student_id: "",
    course: "",
    year: "",
    section: "",
  });

  // 🔴 ACCURACY FIX #4: Multiple photo slots instead of single photo
  const [photoSlots, setPhotoSlots] = useState<PhotoSlot[]>(
    PHOTO_ANGLES.map((angle) => ({
      angle,
      file: null,
      preview: null,
      capturing: false,
    })),
  );
  const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);

  const [syncing, setSyncing] = useState<SyncStatus>({ status: "idle", message: "" });
  const [recentEnrollments, setRecentEnrollments] = useState<
    Array<{ name: string; course: string; time: string; photos: number }>
  >([]);
  const [courseUniforms, setCourseUniforms] = useState<Record<string, CourseUniform[]>>({});
  const [selectedUniform, setSelectedUniform] = useState<string>("");

  // ─── Supabase Client ──────────────────────────────────

  const [supabaseReady, setSupabaseReady] = useState(false);

  // ─── Camera ───────────────────────────────────────────

  const startCamera = useCallback(async (slotIndex: number) => {
    try {
      // Stop any existing stream first
      streamRef.current?.getTracks().forEach((t) => t.stop());

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }
      setActiveSlotIndex(slotIndex);

      // Mark this slot as capturing
      setPhotoSlots((prev) =>
        prev.map((slot, i) => (i === slotIndex ? { ...slot, capturing: true } : slot)),
      );
    } catch (err) {
      console.error("Camera error:", err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setActiveSlotIndex(null);
    setPhotoSlots((prev) => prev.map((slot) => ({ ...slot, capturing: false })));
  }, []);

  const capturePhoto = useCallback(() => {
    if (activeSlotIndex === null) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `${PHOTO_ANGLES[activeSlotIndex].id}_${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        const previewUrl = URL.createObjectURL(blob);

        setPhotoSlots((prev) =>
          prev.map((slot, i) =>
            i === activeSlotIndex ? { ...slot, file, preview: previewUrl, capturing: false } : slot,
          ),
        );

        stopCamera();
      },
      "image/jpeg",
      0.85,
    );
  }, [activeSlotIndex, stopCamera]);

  // ─── Form Handlers ────────────────────────────────────

  const handleInputChange = (field: keyof EnrollmentForm, value: string) => {
    setForm((prev) => {
      const updated = { ...prev, [field]: value };
      if (field === "course") {
        const uniforms = courseUniforms[value];
        if (uniforms && uniforms.length > 0) {
          setSelectedUniform(uniforms[0].uniform_name);
        } else {
          setSelectedUniform(value);
        }
      }
      return updated;
    });
  };

  const removePhoto = (slotIndex: number) => {
    const slot = photoSlots[slotIndex];
    if (slot.preview) URL.revokeObjectURL(slot.preview);
    setPhotoSlots((prev) =>
      prev.map((s, i) =>
        i === slotIndex ? { ...s, file: null, preview: null, capturing: false } : s,
      ),
    );
  };

  const resetForm = () => {
    // Clean up all previews
    photoSlots.forEach((slot) => {
      if (slot.preview) URL.revokeObjectURL(slot.preview);
    });
    setPhotoSlots(
      PHOTO_ANGLES.map((angle) => ({
        angle,
        file: null,
        preview: null,
        capturing: false,
      })),
    );
    setForm({
      name: "",
      student_id: "",
      course: "",
      year: "",
      section: "",
    });
  };

  // ─── Submit ───────────────────────────────────────────

  const takenPhotos = photoSlots.filter((s) => s.file !== null);

  const handleSubmit = async () => {
    // Validation
    if (!form.name.trim()) {
      setSyncing({ status: "error", message: "Student name is required" });
      return;
    }
    if (!form.course) {
      setSyncing({ status: "error", message: "Course is required" });
      return;
    }
    if (takenPhotos.length === 0) {
      setSyncing({ status: "error", message: "Please take at least one photo" });
      return;
    }

    setSyncing({ status: "syncing", message: "Registering student..." });

    try {
      const supabase = getSupabase();
      if (!supabase) {
        setSyncing({ status: "error", message: "Supabase not configured. Check .env.local" });
        return;
      }

      // 🔴 ACCURACY FIX #4: Upload ALL photos to Supabase Storage
      const timestamp = Date.now();
      const photoUrls: string[] = [];

      for (let i = 0; i < takenPhotos.length; i++) {
        const slot = takenPhotos[i];
        if (!slot.file) continue;

        const photoPath = `enrollments/${timestamp}_${form.student_id || "new"}_${slot.angle.id}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from("student-photos")
          .upload(photoPath, slot.file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from("student-photos").getPublicUrl(photoPath);

        photoUrls.push(urlData?.publicUrl || photoPath);
      }

      // Store all photo URLs as a JSON array in photo_url
      const photoUrlJson = JSON.stringify(photoUrls);

      // 2. Create student record
      const uniformType = selectedUniform || form.course;

      const { error: insertError } = await supabase.from("students").insert({
        name: form.name.trim(),
        student_id: form.student_id.trim() || null,
        department: form.course,
        grade: form.year,
        section: form.section || null,
        uniform_type: uniformType,
        photo_url: photoUrlJson,
        person_type: "student",
        is_active: true,
      });

      if (insertError) throw insertError;

      // 3. Success
      setSyncing({ status: "success", message: `${form.name} registered successfully!` });

      setRecentEnrollments((prev) => [
        {
          name: form.name,
          course: form.course,
          time: new Date().toLocaleTimeString(),
          photos: photoUrls.length,
        },
        ...prev.slice(0, 9),
      ]);

      resetForm();
      setIsEnrollModalOpen(false);

      setTimeout(() => setSyncing({ status: "idle", message: "" }), 3000);
    } catch (err) {
      console.error("Enrollment error:", err);
      setSyncing({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to register student",
      });
    }
  };

  // ─── Initialize ────────────────────────────────────────

  useEffect(() => {
    setSupabaseReady(isSupabaseConfigured());
    loadUniformTypes();
  }, []);

  async function loadUniformTypes() {
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { data: courseUniformsData } = await supabase.from("course_uniforms").select(`
          course,
          uniform_type_id,
          uniform_types!inner(name, description)
        `);

      if (courseUniformsData) {
        const grouped: Record<string, CourseUniform[]> = {};
        // Supabase type inference wraps joined relations in arrays,
        // but !inner join returns a single object at runtime.
        // The `as any[]` is required because Supabase's generic types
        // don't perfectly model the actual query shape.
        for (const cu of courseUniformsData as any[]) {
          const course = cu.course;
          if (!grouped[course]) grouped[course] = [];
          grouped[course].push({
            course: cu.course,
            uniform_type_id: cu.uniform_type_id,
            uniform_name: cu.uniform_types.name,
            uniform_description: cu.uniform_types.description || cu.uniform_types.name,
          });
        }
        setCourseUniforms(grouped);
      }
    } catch (err) {
      console.error("Failed to load uniform types:", err);
    }
  }

  // ─── Cleanup ──────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopCamera();
      photoSlots.forEach((slot) => {
        if (slot.preview) URL.revokeObjectURL(slot.preview);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopCamera]);

  // ─── Render ───────────────────────────────────────────

  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-yellow-100 flex items-center justify-center shadow-sm border border-yellow-200">
            <AlertTriangle className="w-8 h-8 text-yellow-600" />
          </div>
          <h1 className="text-2xl font-bold text-surface-900 flex items-center justify-center gap-2">
            <Shield className="w-6 h-6 text-primary-600" />
            Guard Station
          </h1>
          <p className="text-surface-500 text-sm mt-1 mb-6">Student enrollment & registration</p>
          <div className="glass-card p-6">
            <p className="text-yellow-600 font-bold mb-2 flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Supabase Not Configured
            </p>
            <p className="text-surface-400 text-sm">
              Create a <code className="text-primary-400">.env.local</code> file with your Supabase
              credentials:
            </p>
            <pre className="mt-3 p-3 bg-surface-800 rounded-lg text-xs text-left text-surface-300 font-mono">
              NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co{`\n`}
              NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 p-6">
      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Camera overlay when active */}
      {activeSlotIndex !== null && (
        <div className="fixed inset-0 z-[60] bg-surface-900/95 backdrop-blur-sm flex flex-col items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full max-w-lg aspect-[4/3] object-cover rounded-2xl"
          />
          <div className="mt-6 text-center">
            <p className="text-white text-lg font-medium mb-2">
              {PHOTO_ANGLES[activeSlotIndex].icon} {PHOTO_ANGLES[activeSlotIndex].instruction}
            </p>
            <p className="text-white/50 text-sm mb-6">{PHOTO_ANGLES[activeSlotIndex].tip}</p>
            <div className="flex gap-4 justify-center">
              <button onClick={capturePhoto} className="btn-primary text-lg px-8 flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Capture
              </button>
              <button
                onClick={stopCamera}
                className="px-6 py-3 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-xl transition-colors flex items-center gap-2"
              >
                <X className="w-5 h-5" />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-surface-200 flex items-center justify-center">
            <Shield className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Guard Station</h1>
            <p className="text-surface-500 text-sm font-medium mt-1">Student enrollment & registration</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              syncing.status === "success"
                ? "bg-green-100 text-green-700"
                : syncing.status === "error"
                  ? "bg-red-100 text-red-700"
                  : "bg-surface-200 text-surface-600"
            }`}
          >
            {syncing.message || "Ready"}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Main Form ──────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card p-12 text-center flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center mb-6">
              <UserPlus className="w-8 h-8 text-primary-600" />
            </div>
            <h2 className="text-2xl font-bold text-surface-900 mb-2">New Enrollment</h2>
            <p className="text-surface-500 max-w-md mb-8">
              Register a new student into the system. You'll need to fill out their information and capture photos for facial recognition.
            </p>
            <button
              onClick={() => setIsEnrollModalOpen(true)}
              className="btn-primary px-8 py-3.5 text-lg flex items-center gap-2 shadow-lg shadow-primary-500/20 hover:shadow-primary-500/30 transition-all"
            >
              <UserPlus className="w-5 h-5" />
              Add Student
            </button>
          </div>

          {/* 🔴 Modal Implementation for Enrollment */}
          {isEnrollModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
              <div className="absolute inset-0 bg-surface-900/40 backdrop-blur-sm" onClick={() => setIsEnrollModalOpen(false)} />
              <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-6 border-b border-surface-100 bg-white z-10">
                  <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
                    <UserPlus className="w-6 h-6 text-primary-500" />
                    Enroll New Student
                  </h2>
                  <button onClick={() => setIsEnrollModalOpen(false)} className="p-2 hover:bg-surface-100 rounded-full transition-colors text-surface-500">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                {/* Modal Body - Scrollable */}
                <div className="p-6 overflow-y-auto space-y-8 bg-surface-50/50">
                  {/* Photos Section */}
          <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-surface-900 flex items-center gap-2">
                <CameraIcon className="w-5 h-5 text-primary-500" />
                Student Photos
              </h2>
              <span className="text-sm font-medium text-surface-500">
                {takenPhotos.length}/{PHOTO_ANGLES.length} taken
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PHOTO_ANGLES.map((angle, index) => {
                const slot = photoSlots[index];
                const isTaken = slot.file !== null;

                return (
                  <div key={angle.id} className="flex flex-col items-center">
                    {/* Photo preview box */}
                    <div
                      className={`w-full aspect-[4/3] rounded-xl border-2 flex items-center justify-center overflow-hidden transition-all duration-200 ${
                        isTaken
                          ? "border-green-500/50 bg-green-500/5"
                          : activeSlotIndex === index
                            ? "border-primary-500 bg-primary-500/5"
                            : "border-dashed border-surface-300 bg-surface-50"
                      }`}
                    >
                      {slot.preview ? (
                        <img
                          src={slot.preview}
                          alt={angle.label}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center p-2">
                          <span className="text-2xl block mb-1 flex justify-center">{angle.icon}</span>
                          <p className="text-surface-500 font-medium text-xs">{angle.label}</p>
                        </div>
                      )}
                    </div>

                    {/* Photo status indicator */}
                    <div className="flex items-center gap-2 mt-2">
                      {isTaken ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                          <span className="text-xs font-bold text-green-700">Captured</span>
                        </>
                      ) : activeSlotIndex === index ? (
                        <>
                          <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                          <span className="text-xs font-bold text-primary-600">Capturing...</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 rounded-full bg-surface-300" />
                          <span className="text-xs font-medium text-surface-500">Pending</span>
                        </>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 mt-2">
                      {isTaken ? (
                        <button
                          onClick={() => {
                            removePhoto(index);
                            startCamera(index);
                          }}
                          className="text-xs px-3 py-1.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-lg transition-colors flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Retake
                        </button>
                      ) : (
                        <button
                          onClick={() => startCamera(index)}
                          className="text-xs px-3 py-1.5 bg-primary-50 hover:bg-primary-100 text-primary-700 font-medium rounded-lg transition-colors flex items-center gap-1"
                        >
                          <Camera className="w-3 h-3" />
                          Take
                        </button>
                      )}
                      {isTaken && (
                        <button
                          onClick={() => removePhoto(index)}
                          className="text-xs px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 font-medium rounded-lg transition-colors flex items-center gap-1"
                        >
                          <X className="w-3 h-3" />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Angle instructions */}
            <div className="mt-6 p-4 bg-primary-50 border border-primary-100 rounded-xl">
              <p className="text-sm text-primary-800 font-bold mb-3 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-primary-600" />
                For best face recognition accuracy:
              </p>
              <ul className="space-y-2">
                <li className="flex items-center gap-2 text-sm text-primary-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                  Take <strong className="text-primary-900">3 photos</strong> from different angles
                </li>
                <li className="flex items-center gap-2 text-sm text-primary-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                  Ensure <strong className="text-primary-900">good lighting</strong> — avoid shadows on
                  face
                </li>
                <li className="flex items-center gap-2 text-sm text-primary-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                  Student should have a{" "}
                  <strong className="text-primary-900">neutral expression</strong>
                </li>
                <li className="flex items-center gap-2 text-sm text-primary-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                  <strong className="text-primary-900">Minimum 1 photo</strong> required, 3 recommended
                </li>
              </ul>
            </div>
          </div>

          {/* Student Info Section */}
          <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
            <h2 className="text-lg font-bold text-surface-900 mb-5 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-primary-500" />
              Student Information
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2">
                <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  placeholder="e.g., Juan Dela Cruz"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                  Student ID
                </label>
                <input
                  type="text"
                  value={form.student_id}
                  onChange={(e) => handleInputChange("student_id", e.target.value)}
                  placeholder="e.g., 2024-001"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                  Course / Department *
                </label>
                <select
                  value={form.course}
                  onChange={(e) => handleInputChange("course", e.target.value)}
                  className="input-field appearance-none"
                >
                  <option value="">Select course...</option>
                  {COURSES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {form.course && !courseUniforms[form.course] && (
                  <p className="mt-1.5 text-xs text-yellow-400">
                    No uniform types configured for this course in Supabase
                  </p>
                )}
              </div>

              {form.course &&
                courseUniforms[form.course] &&
                courseUniforms[form.course].length > 0 && (
                  <div>
                    <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                      Uniform Type
                    </label>
                    <select
                      value={selectedUniform}
                      onChange={(e) => setSelectedUniform(e.target.value)}
                      className="input-field appearance-none"
                    >
                      {courseUniforms[form.course].map((u) => (
                        <option key={u.uniform_type_id} value={u.uniform_name}>
                          {u.uniform_description}
                        </option>
                      ))}
                    </select>
                    {selectedUniform && (
                      <p className="mt-1.5 text-xs text-primary-400">
                        YOLO will detect: <strong>{selectedUniform}</strong>
                      </p>
                    )}
                  </div>
                )}

              <div>
                <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                  Year Level
                </label>
                <select
                  value={form.year}
                  onChange={(e) => handleInputChange("year", e.target.value)}
                  className="input-field appearance-none"
                >
                  <option value="">Select year...</option>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-surface-700 mb-1.5 font-bold">Section</label>
                <select
                  value={form.section}
                  onChange={(e) => handleInputChange("section", e.target.value)}
                  className="input-field appearance-none"
                >
                  <option value="">Select section...</option>
                  {SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      Section {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            </div>
            </div>

            {/* Form Actions */}
            <div className="flex gap-3 p-6 border-t border-surface-100 bg-white z-10">
              <button
                onClick={handleSubmit}
                disabled={
                  syncing.status === "syncing" ||
                  !form.name ||
                  !form.course ||
                  takenPhotos.length === 0
                }
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {syncing.status === "syncing" ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Registering...
                  </span>
                ) : (
                  `Register Student (${takenPhotos.length} photo${takenPhotos.length !== 1 ? "s" : ""})`
                )}
              </button>
              <button
                onClick={() => {
                  resetForm();
                  setIsEnrollModalOpen(false);
                }}
                className="px-6 py-3 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
          </div>
          )}
        </div>

        {/* ─── Sidebar ──────────────────────────────────── */}
        <div className="space-y-6">
          {/* Enrollment Tips */}
          <div className="glass-card p-5">
            <h3 className="text-lg font-bold text-surface-900 mb-4 flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-yellow-500" />
              Photo Tips
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg border border-green-100">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-green-900 text-sm font-bold">Good</p>
                  <p className="text-green-700 text-xs mt-0.5 font-medium">
                    Face centered, good lighting, neutral expression
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-red-50 rounded-lg border border-red-100">
                <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-900 text-sm font-bold">Avoid</p>
                  <p className="text-red-700 text-xs mt-0.5 font-medium">
                    Blurry images, shadows on face, extreme angles
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Uniform Reference */}
          <div className="glass-card p-5">
            <h3 className="text-lg font-bold text-surface-900 mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary-500" />
              Uniform Guide
            </h3>
            <div className="space-y-3 text-sm">
              {COURSES.map((c) => {
                const uniforms = courseUniforms[c.value];
                return (
                  <div key={c.value} className="py-2 px-3 bg-surface-50 border border-surface-100 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-surface-700 font-medium">{c.label}</span>
                    </div>
                    {uniforms ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {uniforms.map((u) => (
                          <span
                            key={u.uniform_type_id}
                            className="text-xs bg-primary-600/20 text-primary-400 px-2 py-0.5 rounded"
                          >
                            {u.uniform_description}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-surface-500 mt-1">No uniforms configured</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Enrollments */}
          <div className="glass-card p-5">
            <h3 className="text-lg font-bold text-surface-900 mb-4 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-primary-500" />
              Recent Enrollments
            </h3>
            {recentEnrollments.length > 0 ? (
              <div className="space-y-2">
                {recentEnrollments.map((e, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm border-b border-surface-100 last:border-0">
                    <div>
                      <p className="text-surface-900 font-bold">{e.name}</p>
                      <p className="text-surface-500 text-xs font-medium">
                        {e.course} · {e.photos} photos
                      </p>
                    </div>
                    <span className="text-surface-400 text-xs font-medium">{e.time}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-surface-500 text-sm font-medium">No enrollments yet</p>
            )}
          </div>

          {/* Quick Actions */}
          <div className="glass-card p-5">
            <h3 className="text-lg font-bold text-surface-900 mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-500" />
              Quick Actions
            </h3>
            <div className="space-y-3">
              <a
                href="http://localhost:3002"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-4 py-3 bg-primary-50 hover:bg-primary-100 text-primary-700 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                <ScreenShare className="w-4 h-4" />
                Open Kiosk
              </a>
              <a
                href="http://localhost:3000"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-4 py-3 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                <LayoutDashboard className="w-4 h-4" />
                Open Dashboard
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

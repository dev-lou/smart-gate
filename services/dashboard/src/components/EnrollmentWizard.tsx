"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "./ToastProvider";
import {
  Camera,
  Image as ImageIcon,
  CameraIcon,
  RefreshCw,
  X,
  Lightbulb,
  CheckCircle2,
  UserPlus,
  ClipboardList,
  ArrowLeft,
  ArrowRight,
  Upload,
  SwitchCamera,
  AlertTriangle,
} from "lucide-react";

// ─── Shared enrollment constants (same as Guard Station) ─────

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

interface EnrollmentForm {
  name: string;
  student_id: string;
  course: string;
  year: string;
  section: string;
}

const COURSES = [
  { value: "CBMSD", label: "CBMSD" },
  { value: "CICI", label: "CICI" },
  { value: "COAG", label: "COAG" },
  { value: "Education", label: "Education" },
];

const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const SECTIONS = ["A", "B", "C", "D"];

interface EnrollmentWizardProps {
  open: boolean;
  onClose: () => void;
  onEnrolled?: () => void;
}

export default function EnrollmentWizard({ open, onClose, onEnrolled }: EnrollmentWizardProps) {
  const { pushToast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<number>(0);
  const cameraFacingRef = useRef<"user" | "environment">("user");

  const [form, setForm] = useState<EnrollmentForm>({
    name: "",
    student_id: "",
    course: "",
    year: "",
    section: "",
  });
  const [photoSlots, setPhotoSlots] = useState<PhotoSlot[]>(
    PHOTO_ANGLES.map((angle) => ({ angle, file: null, preview: null, capturing: false })),
  );
  const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);
  const [enrollStep, setEnrollStep] = useState<1 | 2 | 3>(1);
  const [syncing, setSyncing] = useState(false);

  // ─── Camera ───────────────────────────────────────────

  const startCamera = useCallback(
    async (slotIndex: number, facing: "user" | "environment" = cameraFacingRef.current) => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        cameraFacingRef.current = facing;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: facing },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setActiveSlotIndex(slotIndex);
        setPhotoSlots((prev) =>
          prev.map((slot, i) => (i === slotIndex ? { ...slot, capturing: true } : slot)),
        );
      } catch (err) {
        console.error("Camera error:", err);
        pushToast("error", "Camera unavailable — use Upload instead");
      }
    },
    [pushToast],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActiveSlotIndex(null);
    setPhotoSlots((prev) => prev.map((slot) => ({ ...slot, capturing: false })));
  }, []);

  useEffect(() => {
    if (activeSlotIndex !== null && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [activeSlotIndex]);

  // ─── Upload ───────────────────────────────────────────

  const openUpload = useCallback((slotIndex: number) => {
    uploadTargetRef.current = slotIndex;
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        pushToast("error", "Please choose an image file (JPG/PNG)");
        return;
      }
      const slotIndex = uploadTargetRef.current;
      setPhotoSlots((prev) => {
        const old = prev[slotIndex];
        if (old.preview) URL.revokeObjectURL(old.preview);
        return prev.map((s, i) =>
          i === slotIndex
            ? { ...s, file, preview: URL.createObjectURL(file), capturing: false }
            : s,
        );
      });
      event.target.value = "";
    },
    [pushToast],
  );

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

  // ─── Form ─────────────────────────────────────────────

  const handleInputChange = (field: keyof EnrollmentForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
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
    photoSlots.forEach((slot) => {
      if (slot.preview) URL.revokeObjectURL(slot.preview);
    });
    setPhotoSlots(
      PHOTO_ANGLES.map((angle) => ({ angle, file: null, preview: null, capturing: false })),
    );
    setForm({ name: "", student_id: "", course: "", year: "", section: "" });
    setEnrollStep(1);
    setSyncing(false);
  };

  // ─── Submit ───────────────────────────────────────────

  const takenPhotos = photoSlots.filter((s) => s.file !== null);

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      pushToast("error", "Student name is required");
      return;
    }
    if (!form.course) {
      pushToast("error", "Course is required");
      return;
    }
    if (takenPhotos.length === 0) {
      pushToast("error", "Please take at least one photo");
      return;
    }

    setSyncing(true);
    try {
      const supabase = getSupabase();
      if (!supabase) {
        pushToast("error", "Supabase not configured. Check .env.local");
        setSyncing(false);
        return;
      }

      const timestamp = Date.now();
      const photoUrls: string[] = [];

      for (const slot of takenPhotos) {
        if (!slot.file) continue;
        const photoPath = `enrollments/${timestamp}_${form.student_id || "new"}_${slot.angle.id}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("student-photos")
          .upload(photoPath, slot.file);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("student-photos").getPublicUrl(photoPath);
        photoUrls.push(urlData?.publicUrl || photoPath);
      }

      // The course IS the uniform: the kiosk accepts ANY uniform of the
      // student's course (blazer/female/male all verify a CICI student).
      const { error: insertError } = await supabase.from("students").insert({
        name: form.name.trim(),
        student_id: form.student_id.trim() || null,
        department: form.course,
        grade: form.year,
        section: form.section || null,
        uniform_type: form.course || "default",
        photo_url: JSON.stringify(photoUrls),
        person_type: "student",
        is_active: true,
      });
      if (insertError) throw insertError;

      pushToast("success", `${form.name} registered successfully — ready for kiosk sync`);
      onEnrolled?.();
      resetForm();
      onClose();
    } catch (err) {
      console.error("Enrollment error:", err);
      pushToast("error", err instanceof Error ? err.message : "Failed to register student");
    } finally {
      setSyncing(false);
    }
  };

  // ─── Cleanup ──────────────────────────────────────────

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      photoSlots.forEach((slot) => {
        if (slot.preview) URL.revokeObjectURL(slot.preview);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  return (
    <>
      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} className="hidden" />
      {/* Hidden file input for Upload Photo */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* FULLSCREEN camera overlay */}
      {activeSlotIndex !== null && (
        <div className="fixed inset-0 z-[60] bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          <div className="absolute top-0 inset-x-0 p-6 pb-16 bg-gradient-to-b from-black/80 to-transparent text-center pointer-events-none">
            <div className="inline-flex items-center gap-2 text-white text-lg sm:text-2xl font-bold drop-shadow">
              {PHOTO_ANGLES[activeSlotIndex].icon}
              {PHOTO_ANGLES[activeSlotIndex].instruction}
            </div>
            <p className="text-white/70 text-sm sm:text-base mt-1 drop-shadow">
              {PHOTO_ANGLES[activeSlotIndex].tip}
            </p>
          </div>
          <div className="absolute bottom-0 inset-x-0 p-8 pt-16 bg-gradient-to-t from-black/80 to-transparent">
            <div className="flex items-end justify-center gap-6">
              <button
                onClick={stopCamera}
                className="px-6 py-3 bg-white/10 hover:bg-white/20 backdrop-blur border border-white/30 text-white rounded-full transition-colors flex items-center gap-2 cursor-pointer"
              >
                <X className="w-5 h-5" />
                Cancel
              </button>
              <button
                onClick={capturePhoto}
                className="w-20 h-20 rounded-full border-4 border-white bg-white/20 backdrop-blur hover:bg-white/30 transition-all flex items-center justify-center cursor-pointer"
                aria-label="Capture photo"
              >
                <span className="w-14 h-14 rounded-full bg-white shadow-lg" />
              </button>
              <button
                onClick={() => {
                  if (activeSlotIndex === null) return;
                  const next = cameraFacingRef.current === "user" ? "environment" : "user";
                  startCamera(activeSlotIndex, next);
                }}
                className="px-5 py-3 bg-white/10 hover:bg-white/20 backdrop-blur border border-white/30 text-white rounded-full transition-colors flex items-center gap-2 cursor-pointer"
                aria-label="Switch camera"
              >
                <SwitchCamera className="w-5 h-5" />
                Flip
              </button>
            </div>
            <p className="text-center text-white/60 text-xs mt-4 font-medium">
              {PHOTO_ANGLES[activeSlotIndex].label} photo · {PHOTO_ANGLES[activeSlotIndex].tip}
            </p>
          </div>
        </div>
      )}

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <div
          className="absolute inset-0 bg-surface-900/40 backdrop-blur-sm"
          onClick={() => {
            resetForm();
            onClose();
          }}
        />
        <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header + Stepper */}
          <div className="p-6 border-b border-surface-100 bg-white z-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
                  <UserPlus className="w-6 h-6 text-primary-500" />
                  Enroll New Student
                </h2>
                <p className="text-xs font-medium text-surface-500 mt-0.5">
                  {enrollStep === 1 && "Step 1 of 3: Capture Biometric Photos"}
                  {enrollStep === 2 && "Step 2 of 3: Student Information"}
                  {enrollStep === 3 && "Step 3 of 3: Review & Finalize Registration"}
                </p>
              </div>
              <button
                onClick={() => {
                  resetForm();
                  onClose();
                }}
                className="p-2 hover:bg-surface-100 rounded-full transition-colors text-surface-500 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setEnrollStep(1)}
                className={`flex items-center gap-2 pb-1.5 border-b-2 transition-all text-left ${
                  enrollStep === 1
                    ? "border-primary-600 text-primary-700 font-bold"
                    : enrollStep > 1
                      ? "border-green-600 text-green-700 font-semibold cursor-pointer"
                      : "border-surface-200 text-surface-400 font-medium cursor-default"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    enrollStep > 1
                      ? "bg-green-600 text-white"
                      : enrollStep === 1
                        ? "bg-primary-600 text-white"
                        : "bg-surface-200 text-surface-500"
                  }`}
                >
                  {enrollStep > 1 ? "✓" : "1"}
                </span>
                <span className="text-xs sm:text-sm">1. Photos</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (takenPhotos.length > 0) setEnrollStep(2);
                }}
                className={`flex items-center gap-2 pb-1.5 border-b-2 transition-all text-left ${
                  enrollStep === 2
                    ? "border-primary-600 text-primary-700 font-bold"
                    : enrollStep > 2
                      ? "border-green-600 text-green-700 font-semibold cursor-pointer"
                      : "border-surface-200 text-surface-400 font-medium cursor-default"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    enrollStep > 2
                      ? "bg-green-600 text-white"
                      : enrollStep === 2
                        ? "bg-primary-600 text-white"
                        : "bg-surface-200 text-surface-500"
                  }`}
                >
                  {enrollStep > 2 ? "✓" : "2"}
                </span>
                <span className="text-xs sm:text-sm">2. Information</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (takenPhotos.length > 0 && form.name.trim() && form.course) {
                    setEnrollStep(3);
                  }
                }}
                className={`flex items-center gap-2 pb-1.5 border-b-2 transition-all text-left ${
                  enrollStep === 3
                    ? "border-primary-600 text-primary-700 font-bold"
                    : "border-surface-200 text-surface-400 font-medium cursor-default"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    enrollStep === 3
                      ? "bg-primary-600 text-white"
                      : "bg-surface-200 text-surface-500"
                  }`}
                >
                  3
                </span>
                <span className="text-xs sm:text-sm">3. Review</span>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto space-y-6 bg-surface-50/50 flex-1">
            {/* STEP 1: PHOTOS */}
            {enrollStep === 1 && (
              <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-lg font-bold text-surface-900 flex items-center gap-2">
                      <CameraIcon className="w-5 h-5 text-primary-500" />
                      Student Photos
                    </h3>
                    <p className="text-xs text-surface-500 mt-0.5">
                      Capture face photos from 3 angles to ensure high biometric accuracy at the
                      kiosk.
                    </p>
                  </div>
                  <span
                    className={`text-xs sm:text-sm font-bold px-3 py-1 rounded-full ${
                      takenPhotos.length > 0
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-surface-100 text-surface-600"
                    }`}
                  >
                    {takenPhotos.length}/{PHOTO_ANGLES.length} captured
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {PHOTO_ANGLES.map((angle, index) => {
                    const slot = photoSlots[index];
                    const isTaken = slot.file !== null;
                    return (
                      <div key={angle.id} className="flex flex-col items-center">
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
                              <span className="text-2xl block mb-1 flex justify-center">
                                {angle.icon}
                              </span>
                              <p className="text-surface-500 font-medium text-xs">{angle.label}</p>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-2">
                          {isTaken ? (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                              <span className="text-xs font-bold text-green-700">Captured</span>
                            </>
                          ) : activeSlotIndex === index ? (
                            <>
                              <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                              <span className="text-xs font-bold text-primary-600">
                                Capturing...
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="w-2 h-2 rounded-full bg-surface-300" />
                              <span className="text-xs font-medium text-surface-500">Pending</span>
                            </>
                          )}
                        </div>

                        <div className="flex gap-2 mt-2 flex-wrap justify-center">
                          {isTaken ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  removePhoto(index);
                                  startCamera(index);
                                }}
                                className="text-xs px-3 py-1.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" />
                                Retake
                              </button>
                              <button
                                type="button"
                                onClick={() => openUpload(index)}
                                className="text-xs px-3 py-1.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Upload className="w-3 h-3" />
                                Replace
                              </button>
                              <button
                                type="button"
                                onClick={() => removePhoto(index)}
                                className="text-xs px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 font-medium rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                                Remove
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startCamera(index)}
                                className="text-xs px-3 py-1.5 bg-primary-50 hover:bg-primary-100 text-primary-700 font-medium rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Camera className="w-3 h-3" />
                                Take
                              </button>
                              <button
                                type="button"
                                onClick={() => openUpload(index)}
                                className="text-xs px-3 py-1.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <ImageIcon className="w-3 h-3" />
                                Upload
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 p-4 bg-primary-50 border border-primary-100 rounded-xl">
                  <p className="text-sm text-primary-800 font-bold mb-3 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-primary-600" />
                    For best face recognition accuracy:
                  </p>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2 text-sm text-primary-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                      Take <strong className="text-primary-900">3 photos</strong> from different
                      angles
                    </li>
                    <li className="flex items-center gap-2 text-sm text-primary-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                      Ensure <strong className="text-primary-900">good lighting</strong> — avoid
                      shadows on face
                    </li>
                    <li className="flex items-center gap-2 text-sm text-primary-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                      Student should have a{" "}
                      <strong className="text-primary-900">neutral expression</strong>
                    </li>
                    <li className="flex items-center gap-2 text-sm text-primary-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                      <strong className="text-primary-900">Minimum 1 photo</strong> required to
                      proceed
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* STEP 2: INFORMATION */}
            {enrollStep === 2 && (
              <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
                <div className="mb-5">
                  <h3 className="text-lg font-bold text-surface-900 flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-primary-500" />
                    Student Information
                  </h3>
                  <p className="text-xs text-surface-500 mt-0.5">
                    Enter official academic profile details for student verification.
                  </p>
                </div>

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
                      placeholder="e.g., 2026-001"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                      Course *
                    </label>
                    <select
                      value={form.course}
                      onChange={(e) => handleInputChange("course", e.target.value)}
                      className="input-field"
                    >
                      <option value="">Select course...</option>
                      {COURSES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                      Year Level
                    </label>
                    <select
                      value={form.year}
                      onChange={(e) => handleInputChange("year", e.target.value)}
                      className="input-field"
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
                    <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                      Section
                    </label>
                    <select
                      value={form.section}
                      onChange={(e) => handleInputChange("section", e.target.value)}
                      className="input-field"
                    >
                      <option value="">Select section...</option>
                      {SECTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  {form.course && (
                    <div className="md:col-span-2">
                      <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-primary-50 border border-primary-100 text-xs font-bold text-primary-800">
                        <CheckCircle2 className="w-4 h-4 text-primary-600 shrink-0" />
                        Uniform: any {form.course} uniform is accepted automatically at the kiosk
                      </div>
                      <p className="text-xs text-surface-400 font-medium mt-1.5">
                        No need to pick a type — male/female/blazer variants all verify a{" "}
                        {form.course} student.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STEP 3: REVIEW */}
            {enrollStep === 3 && (
              <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
                <div className="mb-5">
                  <h3 className="text-lg font-bold text-surface-900 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-primary-500" />
                    Review & Finalize
                  </h3>
                  <p className="text-xs text-surface-500 mt-0.5">
                    Confirm the details below — this student will be available at the kiosk after
                    the next sync.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  {photoSlots.map((slot, index) => (
                    <div
                      key={PHOTO_ANGLES[index].id}
                      className="rounded-xl overflow-hidden border border-surface-200"
                    >
                      {slot.preview ? (
                        <img
                          src={slot.preview}
                          alt={PHOTO_ANGLES[index].label}
                          className="w-full aspect-[4/3] object-cover"
                        />
                      ) : (
                        <div className="w-full aspect-[4/3] bg-surface-50 flex items-center justify-center text-surface-400 text-xs font-bold">
                          Not captured
                        </div>
                      )}
                      <div className="p-2 text-center text-xs font-bold text-surface-600 bg-surface-50 border-t border-surface-100">
                        {PHOTO_ANGLES[index].label}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-surface-200 overflow-hidden">
                  {[
                    { label: "Full Name", value: form.name },
                    { label: "Student ID", value: form.student_id || "—" },
                    { label: "Course", value: form.course },
                    { label: "Year Level", value: form.year || "—" },
                    { label: "Section", value: form.section || "—" },
                    { label: "Uniform", value: form.course || "—" },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between px-4 py-3 border-b border-surface-100 last:border-0"
                    >
                      <span className="text-sm font-medium text-surface-500">{row.label}</span>
                      <span className="text-sm font-bold text-surface-900">{row.value}</span>
                    </div>
                  ))}
                </div>

                {!form.student_id.trim() && (
                  <div className="mt-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    No student ID entered — the record will still be created, but we recommend
                    adding one.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-surface-100 bg-white flex items-center justify-between">
            {enrollStep > 1 ? (
              <button
                type="button"
                onClick={() => setEnrollStep((s) => (s - 1) as 1 | 2 | 3)}
                className="px-5 py-2.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-xl text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            ) : (
              <span />
            )}

            {enrollStep === 1 && (
              <button
                type="button"
                disabled={takenPhotos.length === 0}
                onClick={() => setEnrollStep(2)}
                className="px-6 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center gap-2 cursor-pointer"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {enrollStep === 2 && (
              <button
                type="button"
                disabled={!form.name.trim() || !form.course}
                onClick={() => setEnrollStep(3)}
                className="px-6 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center gap-2 cursor-pointer"
              >
                Review
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {enrollStep === 3 && (
              <button
                type="button"
                disabled={syncing}
                onClick={handleSubmit}
                className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {syncing ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Registering...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Confirm & Register
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

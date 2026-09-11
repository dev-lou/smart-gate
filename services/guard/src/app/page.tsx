"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  Shield,
  ShieldCheck,
  Camera,
  Image as ImageIcon,
  CameraIcon,
  RefreshCw,
  X,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  XCircle,
  Lock,
  UserPlus,
  ClipboardList,
  ArrowLeft,
  ArrowRight,
  Upload,
  SwitchCamera,
  Clock,
  Users,
  Sparkles,
  Search,
  PhoneCall,
  Home,
  BookOpen,
} from "lucide-react";

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

// Course values MUST match course_uniforms.course in the database
// (seeded by migration 005) — the kiosk matches uniforms by these names.
// Adjust labels to your school's full department names if desired.
const COURSES: Course[] = [
  { value: "CBMSD", label: "CBMSD" },
  { value: "CICI", label: "CICI" },
  { value: "COAG", label: "COAG" },
  { value: "Education", label: "Education" },
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

function getDepartmentBadge(dept: string): string {
  const d = (dept || "").toUpperCase();
  if (d.includes("CICI")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (d.includes("CBMSD")) return "bg-amber-50 text-amber-800 border-amber-200";
  if (d.includes("COAG")) return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (d.includes("EDU")) return "bg-purple-50 text-purple-700 border-purple-200";
  return "bg-surface-100 text-surface-700 border-surface-200";
}

function formatUniformLabel(u?: string): string {
  if (!u || u === "default") return "Standard";
  return u
    .replace(/^(cici_|cbmsd_|coag_|edu_|education_)/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Component ──────────────────────────────────────────────

export default function GuardPage() {
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
  const [enrollStep, setEnrollStep] = useState<1 | 2 | 3>(1);

  const [syncing, setSyncing] = useState<SyncStatus>({ status: "idle", message: "" });
  const [recentEnrollments, setRecentEnrollments] = useState<
    Array<{ name: string; course: string; time: string; photos: number; uniform_type?: string }>
  >([]);
  const [currentTime, setCurrentTime] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDeptFilter, setSelectedDeptFilter] = useState("ALL");
  const [activeTab, setActiveTab] = useState<"home" | "directory" | "uniforms">("home");

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }),
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // ─── Toasts (modern feedback UI) ───────────────────────

  type ToastType = "success" | "error" | "info";
  interface ToastItem {
    id: number;
    type: ToastType;
    message: string;
  }
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  const pushToast = useCallback((type: ToastType, message: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const [courseUniforms, setCourseUniforms] = useState<Record<string, CourseUniform[]>>({});

  // ─── Branding (school name + initials from system_settings) ──
  const [schoolName, setSchoolName] = useState(
    "Iloilo State University of Fisheries Science and Technology",
  );
  const [schoolInitials, setSchoolInitials] = useState("ISUFST");

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    (async () => {
      try {
        const { data } = await supabase.from("system_settings").select("key, value");
        if (!data) return;
        const map: Record<string, string> = {};
        for (const row of data) map[row.key] = row.value;
        if (map.school_name && map.school_name !== "Smart Academy") {
          setSchoolName(map.school_name);
        }
        if (map.school_initials) setSchoolInitials(map.school_initials);
      } catch {
        /* offline — keep fallback branding */
      }
    })();
  }, []);

  // ─── Supabase Client ──────────────────────────────────

  const [guardUser, setGuardUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // ─── Camera ───────────────────────────────────────────

  const startCamera = useCallback(
    async (slotIndex: number, facing: "user" | "environment" = cameraFacingRef.current) => {
      try {
        // Stop any existing stream first
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        cameraFacingRef.current = facing;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: facing },
        });
        // Keep the stream in a ref and mount the overlay; an effect below
        // attaches it to the <video> once it actually exists in the DOM.
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setActiveSlotIndex(slotIndex);

        // Mark this slot as capturing
        setPhotoSlots((prev) =>
          prev.map((slot, i) => (i === slotIndex ? { ...slot, capturing: true } : slot)),
        );
      } catch (err) {
        console.error("Camera error:", err);
      }
    },
    [],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActiveSlotIndex(null);
    setPhotoSlots((prev) => prev.map((slot) => ({ ...slot, capturing: false })));
  }, []);

  // Attach the camera stream once the overlay's <video> is mounted
  // (the ref is null during the getUserMedia await, so this effect
  // is what actually wires the feed to the element).
  useEffect(() => {
    if (activeSlotIndex !== null && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [activeSlotIndex]);

  // ─── Upload (file picker instead of camera) ──────────

  const openUpload = useCallback((slotIndex: number) => {
    uploadTargetRef.current = slotIndex;
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      pushToast("error", "Please choose an image file (JPG/PNG)");
      return;
    }
    const slotIndex = uploadTargetRef.current;
    // Revoke the old preview if one exists
    setPhotoSlots((prev) => {
      const old = prev[slotIndex];
      if (old.preview) URL.revokeObjectURL(old.preview);
      return prev.map((s, i) =>
        i === slotIndex ? { ...s, file, preview: URL.createObjectURL(file), capturing: false } : s,
      );
    });
    setSyncing({ status: "idle", message: "" });
    // Allow picking the same file again later
    event.target.value = "";
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
    setEnrollStep(1);
  };

  // ─── Submit ───────────────────────────────────────────

  const takenPhotos = photoSlots.filter((s) => s.file !== null);

  const handleSubmit = async () => {
    // Validation
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
      // The course IS the uniform: the kiosk accepts ANY uniform of the
      // student's course (e.g. CICI blazer/female/male all verify a CICI
      // student), so we store the course as uniform_type.
      const { error: insertError } = await supabase.from("students").insert({
        name: form.name.trim(),
        student_id: form.student_id.trim() || null,
        department: form.course,
        grade: form.year,
        section: form.section || null,
        uniform_type: form.course || "default",
        photo_url: photoUrlJson,
        person_type: "student",
        is_active: true,
      });

      if (insertError) throw insertError;

      // 3. Success — toast + refresh the recent list from the DB
      setSyncing({ status: "idle", message: "" });
      pushToast("success", `${form.name} registered successfully — ready for kiosk sync`);
      void loadRecentEnrollments();

      resetForm();
      setIsEnrollModalOpen(false);
    } catch (err) {
      console.error("Enrollment error:", err);
      setSyncing({ status: "idle", message: "" });
      pushToast("error", err instanceof Error ? err.message : "Failed to register student");
    }
  };

  // ─── Authentication ────────────────────────────────────

  async function handleGuardLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);

    const supabase = getSupabase();
    if (!supabase) {
      setAuthError("Supabase is not configured. Check .env.local.");
      setAuthSubmitting(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });

    if (error) {
      setAuthError(error.message);
    } else {
      setGuardUser(data.user);
      setAuthPassword("");
      pushToast("success", `Signed in as ${data.user.email}`);
    }
    setAuthSubmitting(false);
  }

  async function handleGuardLogout() {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    setGuardUser(null);
  }

  // ─── Initialize ────────────────────────────────────────

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      setGuardUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setGuardUser(session?.user ?? null);
      setAuthLoading(false);
    });

    loadUniformTypes();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Load the real recent enrollments from Supabase (persists across refreshes)
  useEffect(() => {
    if (guardUser) {
      loadRecentEnrollments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardUser]);

  async function loadRecentEnrollments() {
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      // "Recent" = the newest enrollments in the database, newest first (max 10)
      const { data, error } = await supabase
        .from("students")
        .select("name, department, uniform_type, photo_url, created_at")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        console.error("Failed to load recent enrollments:", error);
        return;
      }

      setRecentEnrollments(
        (data ?? []).map((s: any) => {
          let photos = 0;
          const raw = s.photo_url;
          if (typeof raw === "string" && raw.trim()) {
            try {
              const parsed = JSON.parse(raw);
              photos = Array.isArray(parsed) ? parsed.length : 1;
            } catch {
              photos = 1; // legacy single-URL format
            }
          }
          const date = s.created_at ? new Date(s.created_at) : null;
          return {
            name: s.name ?? "Unknown",
            course: s.department ?? "",
            uniform_type: s.uniform_type ?? "",
            time: date
              ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
                " · " +
                date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
              : "",
            photos,
          };
        }),
      );
    } catch (err) {
      console.error("Failed to load recent enrollments:", err);
    }
  }

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

  // ─── Filtered Enrollments (Search + Department) ──────
  const filteredEnrollments = recentEnrollments.filter((e) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      query === "" ||
      (e.name && e.name.toLowerCase().includes(query)) ||
      (e.course && e.course.toLowerCase().includes(query)) ||
      (e.uniform_type && e.uniform_type.toLowerCase().includes(query));

    const matchesDept =
      selectedDeptFilter === "ALL" ||
      (e.course && e.course.toUpperCase() === selectedDeptFilter.toUpperCase());

    return matchesSearch && matchesDept;
  });

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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
        <div className="glass-card p-8 text-center">
          <div className="w-10 h-10 mx-auto mb-4 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          <p className="text-surface-700 font-bold">Checking Guard Station session...</p>
        </div>
      </div>
    );
  }

  if (!guardUser) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white border border-surface-200 shadow-sm flex items-center justify-center">
              <Lock className="w-8 h-8 text-primary-500" />
            </div>
            <h1 className="text-2xl font-bold text-surface-900">Guard Station</h1>
            <p className="text-surface-500 text-sm font-medium mt-1">
              Authorized enrollment access
            </p>
          </div>

          <form onSubmit={handleGuardLogin} className="glass-card p-6 space-y-4">
            <div>
              <label className="block text-sm text-surface-700 mb-1.5 font-bold">Email</label>
              <input
                type="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="admin@school.edu"
                autoComplete="username"
                className="w-full px-4 py-3 bg-white border border-surface-200 rounded-xl text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-surface-700 mb-1.5 font-bold">Password</label>
              <input
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full px-4 py-3 bg-white border border-surface-200 rounded-xl text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                required
              />
            </div>
            {authError && (
              <p className="text-red-700 font-medium text-sm bg-red-50 px-3 py-2 rounded-lg border border-red-100">
                {authError}
              </p>
            )}
            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl transition-all disabled:opacity-50"
            >
              {authSubmitting ? "Signing in..." : "Sign In to Guard Station"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 p-6">
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

      {/* FULLSCREEN camera overlay when active */}
      {activeSlotIndex !== null && (
        <div className="fixed inset-0 z-[60] bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

          {/* Top instruction bar */}
          <div className="absolute top-0 inset-x-0 p-6 pb-16 bg-gradient-to-b from-black/80 to-transparent text-center pointer-events-none">
            <div className="inline-flex items-center gap-2 text-white text-lg sm:text-2xl font-bold drop-shadow">
              {PHOTO_ANGLES[activeSlotIndex].icon}
              {PHOTO_ANGLES[activeSlotIndex].instruction}
            </div>
            <p className="text-white/70 text-sm sm:text-base mt-1 drop-shadow">
              {PHOTO_ANGLES[activeSlotIndex].tip}
            </p>
          </div>

          {/* Bottom controls */}
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

      {/* ─── Unified Institutional Header (No Stacked Bars) ─── */}
      <header className="bg-white rounded-2xl border border-surface-200 shadow-xs p-4 sm:p-5 mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-primary-600 flex items-center justify-center text-white font-black text-[10px] sm:text-xs shadow-sm shrink-0">
            {schoolInitials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-surface-900 tracking-tight">Guard Station</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary-50 text-primary-700 border border-primary-100">
                Gate 01
              </span>
            </div>
            <p
              className="text-surface-500 text-xs font-medium truncate max-w-[44rem]"
              title={schoolName}
            >
              <span className="font-bold text-primary-600">{schoolName}</span>
              <span className="mx-1.5">·</span>
              Student Biometric Enrollment & Turnstile Access
            </p>
          </div>
        </div>

        {/* Center: Integrated Navigation Tabs */}
        <nav className="flex items-center gap-1.5 bg-surface-100 p-1.5 rounded-xl border border-surface-200/80 self-start lg:self-center overflow-x-auto">
          <button
            onClick={() => setActiveTab("home")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "home"
                ? "bg-white text-surface-900 shadow-xs"
                : "text-surface-600 hover:text-surface-900"
            }`}
          >
            <Home className="w-4 h-4 text-primary-600" />
            <span>Station Home</span>
          </button>

          <button
            onClick={() => setActiveTab("directory")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "directory"
                ? "bg-white text-surface-900 shadow-xs"
                : "text-surface-600 hover:text-surface-900"
            }`}
          >
            <Users className="w-4 h-4 text-primary-600" />
            <span>Student Directory</span>
            <span className="px-1.5 py-0.5 rounded-full text-[11px] font-black bg-surface-100 text-surface-700 border border-surface-200">
              {recentEnrollments.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("uniforms")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "uniforms"
                ? "bg-white text-surface-900 shadow-xs"
                : "text-surface-600 hover:text-surface-900"
            }`}
          >
            <BookOpen className="w-4 h-4 text-primary-600" />
            <span>Uniform & Photo Guide</span>
          </button>
        </nav>

        {/* Right: Clock & Sign Out */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {currentTime && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-50 border border-surface-200 text-surface-700 font-mono text-xs font-bold">
              <Clock className="w-3.5 h-3.5 text-primary-600" />
              <span>{currentTime}</span>
            </div>
          )}

          {guardUser?.email && (
            <div className="hidden xl:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-50 border border-surface-200 text-xs font-semibold text-surface-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{guardUser.email}</span>
            </div>
          )}

          <div className="px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Ready</span>
          </div>

          <button
            onClick={handleGuardLogout}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white border border-surface-200 text-surface-700 hover:bg-surface-50 transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* 🔴 Modal Implementation for Enrollment (3-Step Wizard, Global across tabs) */}
      {isEnrollModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-surface-900/40 backdrop-blur-sm"
            onClick={() => {
              resetForm();
              setIsEnrollModalOpen(false);
            }}
          />
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header & Step Indicator */}
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
                    setIsEnrollModalOpen(false);
                  }}
                  className="p-2 hover:bg-surface-100 rounded-full transition-colors text-surface-500 cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Stepper Progress Indicator */}
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

            {/* Modal Body - Scrollable */}
            <div className="p-6 overflow-y-auto space-y-6 bg-surface-50/50 flex-1">
              {/* STEP 1: PHOTOS ONLY */}
              {enrollStep === 1 && (
                <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm animate-in fade-in duration-200">
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
                                <span className="text-2xl block mb-1 flex justify-center">
                                  {angle.icon}
                                </span>
                                <p className="text-surface-500 font-medium text-xs">
                                  {angle.label}
                                </p>
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
                                <span className="text-xs font-bold text-primary-600">
                                  Capturing...
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="w-2 h-2 rounded-full bg-surface-300" />
                                <span className="text-xs font-medium text-surface-500">
                                  Pending
                                </span>
                              </>
                            )}
                          </div>

                          {/* Action buttons */}
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

                  {/* Angle instructions */}
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

              {/* STEP 2: STUDENT INFORMATION */}
              {enrollStep === 2 && (
                <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm animate-in fade-in duration-200">
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
                        <p className="mt-1.5 text-xs text-yellow-500">
                          No uniform types configured for this course in Supabase
                        </p>
                      )}
                    </div>

                    {form.course && (
                      <div>
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-primary-50 border border-primary-100 text-xs font-bold text-primary-800">
                          <ShieldCheck className="w-4 h-4 text-primary-600 shrink-0" />
                          Uniform: any {form.course} uniform is accepted automatically at the kiosk
                        </div>
                        <p className="mt-1.5 text-xs text-surface-400 font-medium">
                          No need to pick a type — male/female/blazer variants all verify a{" "}
                          {form.course} student.
                        </p>
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
                      <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                        Section
                      </label>
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
              )}

              {/* STEP 3: REVIEW & CONFIRM */}
              {enrollStep === 3 && (
                <div className="space-y-5 animate-in fade-in duration-200">
                  {/* Student Info Card */}
                  <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4 border-b border-surface-100 pb-3">
                      <h3 className="text-base font-bold text-surface-900 flex items-center gap-2">
                        <ClipboardList className="w-5 h-5 text-primary-500" />
                        Review Student Details
                      </h3>
                      <button
                        type="button"
                        onClick={() => setEnrollStep(2)}
                        className="text-xs text-primary-600 hover:text-primary-700 font-bold hover:underline cursor-pointer"
                      >
                        Edit Info
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-xs text-surface-500 font-medium block">
                          Full Name
                        </span>
                        <span className="font-bold text-surface-900 text-base">
                          {form.name || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-surface-500 font-medium block">
                          Student ID
                        </span>
                        <span className="font-mono font-bold text-surface-900">
                          {form.student_id || "Unassigned"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-surface-500 font-medium block">
                          Department / Course
                        </span>
                        <span className="font-bold text-primary-700">{form.course || "—"}</span>
                      </div>
                      <div>
                        <span className="text-xs text-surface-500 font-medium block">
                          Uniform Type
                        </span>
                        <span className="font-semibold text-surface-800">
                          {form.course || "Standard"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-surface-500 font-medium block">
                          Year Level
                        </span>
                        <span className="font-medium text-surface-800">
                          {form.year || "Not specified"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-surface-500 font-medium block">Section</span>
                        <span className="font-medium text-surface-800">
                          {form.section ? `Section ${form.section}` : "Not specified"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Biometric Photos Card */}
                  <div className="bg-white rounded-2xl p-6 border border-surface-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4 border-b border-surface-100 pb-3">
                      <h3 className="text-base font-bold text-surface-900 flex items-center gap-2">
                        <CameraIcon className="w-5 h-5 text-primary-500" />
                        Biometric Photos ({takenPhotos.length}/{PHOTO_ANGLES.length})
                      </h3>
                      <button
                        type="button"
                        onClick={() => setEnrollStep(1)}
                        className="text-xs text-primary-600 hover:text-primary-700 font-bold hover:underline cursor-pointer"
                      >
                        Edit Photos
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      {photoSlots.map((slot) => (
                        <div key={slot.angle.id} className="text-center">
                          <div className="w-full aspect-[4/3] rounded-xl border-2 border-surface-200 overflow-hidden bg-surface-50 flex items-center justify-center">
                            {slot.preview ? (
                              <img
                                src={slot.preview}
                                alt={slot.angle.label}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-xs text-surface-400 font-medium">
                                Not taken
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex items-center justify-center gap-1">
                            {slot.file ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <span className="w-2 h-2 rounded-full bg-surface-300" />
                            )}
                            <span className="text-xs font-semibold text-surface-700">
                              {slot.angle.label}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Ready Notice */}
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <p className="text-xs text-emerald-800 font-medium">
                      All steps completed. Submitting will register the student and distribute
                      biometric models to connected turnstiles.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Form Actions Footer */}
            <div className="flex items-center justify-between p-6 border-t border-surface-100 bg-white z-10">
              {enrollStep === 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setIsEnrollModalOpen(false);
                    }}
                    className="px-6 py-3 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 font-medium rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => setEnrollStep(2)}
                    disabled={takenPhotos.length === 0}
                    className="btn-primary px-8 py-3 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>Next: Student Info</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}

              {enrollStep === 2 && (
                <>
                  <button
                    type="button"
                    onClick={() => setEnrollStep(1)}
                    className="px-6 py-3 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 font-medium rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Photos</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEnrollStep(3)}
                    disabled={!form.name.trim() || !form.course}
                    className="btn-primary px-8 py-3 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>Next: Review</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}

              {enrollStep === 3 && (
                <>
                  <button
                    type="button"
                    onClick={() => setEnrollStep(2)}
                    className="px-6 py-3 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 font-medium rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Edit</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={syncing.status === "syncing"}
                    className="btn-primary px-8 py-3 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {syncing.status === "syncing" ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Registering...
                      </span>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          Confirm & Register ({takenPhotos.length} photo
                          {takenPhotos.length !== 1 ? "s" : ""})
                        </span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB 1: STATION HOME (CALM, INTUITIVE & ACTION-FOCUSED) ─── */}
      {activeTab === "home" && (
        <div className="space-y-6">
          {/* Calm Welcome & Quick Action Card: Zero Visual Glare, Intuitive & Clean */}
          <div className="bg-white rounded-2xl border border-surface-200 shadow-xs p-6 sm:p-7 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/70 text-emerald-700 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Gate 01 Station Online & Synced</span>
              </div>

              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-surface-900 tracking-tight">
                  Biometric Student Enrollment
                </h2>
                <p className="text-surface-500 text-sm sm:text-base font-medium mt-1 leading-relaxed">
                  Register student credentials, capture 3-angle facial biometrics, and sync with
                  Gate 01 turnstiles.
                </p>
              </div>

              {/* Calm, informative pills without visual noise */}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface-50 text-surface-700 text-xs font-bold border border-surface-200">
                  <Users className="w-3.5 h-3.5 text-primary-600" />
                  <span>
                    <strong>{recentEnrollments.length}</strong> Enrolled Today
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface-50 text-surface-700 text-xs font-bold border border-surface-200">
                  <Camera className="w-3.5 h-3.5 text-indigo-600" />
                  <span>3-Angle Face Scanner Ready</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface-50 text-surface-700 text-xs font-bold border border-surface-200">
                  <Shield className="w-3.5 h-3.5 text-emerald-600" />
                  <span>YOLO11 Uniform AI Active</span>
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                setEnrollStep(1);
                setIsEnrollModalOpen(true);
              }}
              className="w-full md:w-auto px-7 py-4 bg-primary-600 hover:bg-primary-700 active:scale-98 text-white font-black text-base sm:text-lg rounded-xl shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-3 shrink-0 cursor-pointer"
            >
              <UserPlus className="w-5 h-5" />
              <span>+ Enroll Student</span>
            </button>
          </div>

          {/* Today's Recent Enrollments Feed */}
          <div className="bg-white rounded-3xl border border-surface-200 shadow-xs overflow-hidden">
            <div className="p-6 border-b border-surface-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="text-lg sm:text-xl font-black text-surface-900">
                    Recent Enrollments (Today)
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary-50 text-primary-700 border border-primary-100">
                    {recentEnrollments.length} today
                  </span>
                </div>
                <p className="text-surface-500 text-xs sm:text-sm font-medium mt-0.5">
                  Enrolled students are immediately ready for biometric access at Gate 01.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void loadRecentEnrollments();
                    pushToast("info", "List updated");
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-surface-50 hover:bg-surface-100 text-surface-700 text-xs font-bold rounded-xl border border-surface-200 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("directory")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-50 hover:bg-primary-100 text-primary-700 text-xs font-bold rounded-xl border border-primary-100 transition-colors cursor-pointer"
                >
                  <span>View All in Directory</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="divide-y divide-surface-100">
              {recentEnrollments.length > 0 ? (
                recentEnrollments.slice(0, 6).map((student, idx) => (
                  <div
                    key={idx}
                    className="p-4 sm:p-5 hover:bg-surface-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-100 to-indigo-100 border border-indigo-200/60 flex items-center justify-center text-primary-700 font-black text-sm shrink-0">
                        {student.name
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase() || "ST"}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-base font-black text-surface-900 truncate">
                            {student.name}
                          </h4>
                          {student.course && (
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getDepartmentBadge(student.course)}`}
                            >
                              {student.course}
                            </span>
                          )}
                          {student.uniform_type && (
                            <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-surface-100 text-surface-700 border border-surface-200 truncate max-w-[160px]">
                              {formatUniformLabel(student.uniform_type)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-surface-500 flex-wrap">
                          <span className="flex items-center gap-1 font-medium text-surface-600">
                            <Clock className="w-3.5 h-3.5 text-surface-400" />
                            {student.time || "Recently registered"}
                          </span>
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            {student.photos === 1
                              ? "1 Photo Synced"
                              : `${student.photos || 3} Photos Synced`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Turnstile Active
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-12 text-center">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-surface-100 border border-surface-200 flex items-center justify-center">
                    <Users className="w-7 h-7 text-surface-400" />
                  </div>
                  <h4 className="text-base font-bold text-surface-800">
                    No student enrollments yet today
                  </h4>
                  <p className="text-xs sm:text-sm text-surface-500 mt-1 max-w-sm mx-auto">
                    Ready to enroll the first student? Click the button above to begin photo
                    capture.
                  </p>
                  <button
                    onClick={() => {
                      setEnrollStep(1);
                      setIsEnrollModalOpen(true);
                    }}
                    className="mt-4 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer inline-flex items-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Enroll Student</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Clean Guardhouse Hotline Banner */}
          <div className="p-4 bg-white rounded-2xl border border-surface-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-surface-600">
            <div className="flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-indigo-600 shrink-0" />
              <span className="font-bold text-surface-800">Gate 01 Guardhouse Assistance:</span>
              <span>
                Security Dispatch: <strong>Ext. 101</strong>
              </span>
              <span>
                • IT / Kiosk Support: <strong>Ext. 108</strong>
              </span>
              <span>
                • Radio: <strong>Channel 1</strong>
              </span>
            </div>
            <button
              onClick={() => setActiveTab("uniforms")}
              className="text-primary-600 hover:text-primary-700 font-bold hover:underline self-start sm:self-auto cursor-pointer"
            >
              View Uniform & Camera Guide →
            </button>
          </div>
        </div>
      )}

      {/* ─── TAB 2: STUDENT DIRECTORY (DEDICATED TABLE WITH UPPER-RIGHT ENROLL BUTTON) ─── */}
      {activeTab === "directory" && (
        <div className="space-y-6">
          {/* Directory Header with Prominent Upper-Right + Enroll Student */}
          <div className="bg-white p-6 sm:p-7 rounded-3xl border border-surface-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-primary-600 shrink-0">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl sm:text-2xl font-black text-surface-900 tracking-tight">
                      Student Biometric Directory
                    </h2>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary-50 text-primary-700 border border-primary-100">
                      {filteredEnrollments.length} Total Enrolled
                    </span>
                  </div>
                  <p className="text-surface-500 text-xs sm:text-sm font-medium mt-0.5">
                    Search and inspect registered student biometric records active at Gate 01
                    turnstile scanners.
                  </p>
                </div>
              </div>
            </div>

            {/* UPPER RIGHT ACTION BUTTONS */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  void loadRecentEnrollments();
                  pushToast("info", "Directory refreshed");
                }}
                className="px-4 py-3 bg-surface-50 hover:bg-surface-100 text-surface-700 text-xs font-bold rounded-2xl border border-surface-200 transition-colors flex items-center gap-2 cursor-pointer"
                title="Refresh student list"
              >
                <RefreshCw className="w-4 h-4 text-surface-500" />
                <span>Refresh</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEnrollStep(1);
                  setIsEnrollModalOpen(true);
                }}
                className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white font-black text-sm rounded-2xl shadow-md hover:shadow-lg transition-all flex items-center gap-2.5 cursor-pointer active:scale-95"
              >
                <UserPlus className="w-5 h-5" />
                <span>+ Enroll Student</span>
              </button>
            </div>
          </div>

          {/* Search & Department Filters Toolbar */}
          <div className="bg-white p-4 rounded-2xl border border-surface-200 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-surface-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search student by name, student ID, course, or uniform..."
                className="w-full pl-10 pr-9 py-2.5 bg-surface-50 border border-surface-200 rounded-xl text-sm font-medium text-surface-900 placeholder:text-surface-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 p-1 rounded-full cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {["ALL", "CBMSD", "CICI", "COAG", "Education"].map((dept) => (
                <button
                  key={dept}
                  onClick={() => setSelectedDeptFilter(dept)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                    selectedDeptFilter === dept
                      ? "bg-primary-600 text-white shadow-xs"
                      : "bg-surface-50 text-surface-600 hover:bg-surface-100 border border-surface-200"
                  }`}
                >
                  {dept}
                </button>
              ))}
            </div>
          </div>

          {/* Comprehensive Data Table */}
          <div className="bg-white rounded-3xl border border-surface-200 shadow-xs overflow-hidden">
            {filteredEnrollments.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-surface-200 bg-surface-50/75 text-xs font-black text-surface-600 uppercase tracking-wider">
                      <th className="py-4 px-6">Student</th>
                      <th className="py-4 px-6">Department</th>
                      <th className="py-4 px-6">Uniform Style</th>
                      <th className="py-4 px-6">Biometric Photos</th>
                      <th className="py-4 px-6">Registered</th>
                      <th className="py-4 px-6 text-right">Turnstile Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100 text-sm">
                    {filteredEnrollments.map((student, idx) => (
                      <tr key={idx} className="hover:bg-surface-50/80 transition-colors">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-100 to-indigo-100 border border-indigo-200/60 flex items-center justify-center text-primary-700 font-black text-sm shrink-0">
                              {student.name
                                .split(" ")
                                .map((n) => n[0])
                                .slice(0, 2)
                                .join("")
                                .toUpperCase() || "ST"}
                            </div>
                            <div>
                              <p className="font-bold text-surface-900 text-base">{student.name}</p>
                              <p className="text-xs text-surface-400 font-mono">
                                Biometrics Enrolled
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="py-4 px-6">
                          {student.course ? (
                            <span
                              className={`px-2.5 py-1 rounded-full text-xs font-bold border ${getDepartmentBadge(student.course)}`}
                            >
                              {student.course}
                            </span>
                          ) : (
                            <span className="text-xs text-surface-400">—</span>
                          )}
                        </td>

                        <td className="py-4 px-6">
                          <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-surface-100 text-surface-700 border border-surface-200">
                            {formatUniformLabel(student.uniform_type || student.course)}
                          </span>
                        </td>

                        <td className="py-4 px-6">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            {student.photos || 3} of 3 Angles
                          </span>
                        </td>

                        <td className="py-4 px-6 text-surface-500 font-medium text-xs whitespace-nowrap">
                          {student.time || "Recently registered"}
                        </td>

                        <td className="py-4 px-6 text-right">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            Active at Gate 01
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-16 text-center">
                <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-surface-100 border border-surface-200 flex items-center justify-center">
                  <Users className="w-8 h-8 text-surface-400" />
                </div>
                <h4 className="text-base font-bold text-surface-800">
                  {searchQuery || selectedDeptFilter !== "ALL"
                    ? "No matching student records found"
                    : "No students registered yet"}
                </h4>
                <p className="text-xs sm:text-sm text-surface-500 mt-1 max-w-sm mx-auto">
                  {searchQuery || selectedDeptFilter !== "ALL"
                    ? "Try adjusting your search criteria or switch back to ALL departments."
                    : "Use the '+ Enroll Student' button above to register the first student."}
                </p>
                {(searchQuery || selectedDeptFilter !== "ALL") && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedDeptFilter("ALL");
                    }}
                    className="mt-4 px-4 py-2 bg-surface-100 hover:bg-surface-200 text-surface-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 3: UNIFORM & PHOTO GUIDE (DEDICATED REFERENCE HANDBOOK) ─── */}
      {activeTab === "uniforms" && (
        <div className="space-y-6">
          {/* Guide Header */}
          <div className="bg-white p-6 sm:p-7 rounded-3xl border border-surface-200 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-surface-900 tracking-tight">
                Campus Uniform & Biometric Photo Guide
              </h2>
              <p className="text-surface-500 text-xs sm:text-sm font-medium mt-0.5">
                Official guidelines for security guards: approved department uniforms and face
                capture standards.
              </p>
            </div>
          </div>

          {/* Section 1: Photo Capture Standards (High Contrast DOs and DONTs) */}
          <div className="bg-white p-6 sm:p-8 rounded-3xl border border-surface-200 shadow-xs space-y-6">
            <div className="flex items-center gap-3 border-b border-surface-100 pb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                <Lightbulb className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-black text-surface-900">
                  Biometric Camera Capture Rules
                </h3>
                <p className="text-xs text-surface-500 font-medium">
                  Follow these rules to avoid turnstile match errors
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 bg-emerald-50/80 border-2 border-emerald-200 rounded-3xl space-y-3">
                <div className="flex items-center gap-2.5 text-emerald-900 font-black text-base">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                  <span>DO THIS (High Turnstile Recognition)</span>
                </div>
                <ul className="text-sm text-emerald-900 space-y-2.5 pl-8 list-disc font-medium leading-relaxed">
                  <li>Keep the student's face centered inside the frame guide</li>
                  <li>Use bright, balanced lighting with no harsh shadows</li>
                  <li>Student must look directly at camera with natural expression</li>
                  <li>
                    Take all 3 angles: <strong>Front</strong>, <strong>Left 45°</strong>, and{" "}
                    <strong>Right 45°</strong>
                  </li>
                  <li>Ask student to remove caps, sunglasses, and face masks</li>
                </ul>
              </div>

              <div className="p-5 bg-rose-50/80 border-2 border-rose-200 rounded-3xl space-y-3">
                <div className="flex items-center gap-2.5 text-rose-900 font-black text-base">
                  <XCircle className="w-6 h-6 text-rose-600 shrink-0" />
                  <span>AVOID (Will Cause Turnstile Failure)</span>
                </div>
                <ul className="text-sm text-rose-900 space-y-2.5 pl-8 list-disc font-medium leading-relaxed">
                  <li>Do not take blurry, shaken, or out-of-focus photos</li>
                  <li>Avoid strong backlighting from open doors or sunlit windows</li>
                  <li>Do not allow hair or hands to cover eyes, chin, or face outline</li>
                  <li>Avoid extreme head tilts beyond normal 45° rotation</li>
                  <li>Never photograph a photo from another phone or ID card</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Section 2: Prescribed Campus Uniforms by Department */}
          <div className="bg-white p-6 sm:p-8 rounded-3xl border border-surface-200 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-surface-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-primary-600 shrink-0">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-surface-900">
                    Approved Department Uniforms
                  </h3>
                  <p className="text-xs text-surface-500 font-medium">
                    Verified by YOLO11 Vision Model at Turnstiles
                  </p>
                </div>
              </div>
              <span className="text-xs font-black px-3 py-1 rounded-xl bg-surface-100 text-surface-700 border border-surface-200">
                4 Departments Active
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {COURSES.map((c) => {
                const uniforms = courseUniforms[c.value];
                const deptBadge = getDepartmentBadge(c.value);
                return (
                  <div
                    key={c.value}
                    className="p-5 bg-surface-50/70 border border-surface-200 rounded-2xl hover:bg-surface-50 transition-colors space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-black px-3 py-1 rounded-full border ${deptBadge}`}
                      >
                        {c.label}
                      </span>
                      <span className="text-xs text-surface-400 font-semibold">
                        {uniforms?.length || 0} approved style
                        {(uniforms?.length || 0) !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {uniforms && uniforms.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {uniforms.map((u) => (
                          <span
                            key={u.uniform_type_id}
                            className="text-xs font-bold bg-white border border-surface-200 text-surface-800 px-3 py-1.5 rounded-xl shadow-2xs"
                          >
                            {u.uniform_description}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-surface-400 italic">
                        Standard institutional attire
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Guardhouse Dispatch & Support Hotlines */}
          <div className="bg-white p-6 rounded-3xl border border-surface-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <PhoneCall className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-black text-surface-900">
                  Gate 01 Guardhouse Security Dispatch
                </h4>
                <p className="text-xs sm:text-sm text-surface-500 font-medium mt-0.5">
                  Security Dispatch: <strong>Ext. 101</strong> • IT & Turnstile Support:{" "}
                  <strong>Ext. 108</strong> • Radio: <strong>Channel 1</strong>
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveTab("home")}
              className="px-5 py-2.5 bg-surface-100 hover:bg-surface-200 text-surface-700 text-xs font-bold rounded-xl transition-colors cursor-pointer self-start sm:self-auto"
            >
              Back to Station Home
            </button>
          </div>
        </div>
      )}

      {/* ─── Toast viewport ─────────────────────────────── */}
      <div className="fixed bottom-5 right-5 z-[70] w-80 max-w-[calc(100vw-2.5rem)] space-y-2.5 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-enter pointer-events-auto flex items-start gap-3 bg-surface-900/95 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3.5 shadow-2xl shadow-black/30"
            role="status"
          >
            <span
              className={`shrink-0 mt-0.5 ${
                t.type === "success"
                  ? "text-emerald-400"
                  : t.type === "error"
                    ? "text-red-400"
                    : "text-sky-400"
              }`}
            >
              {t.type === "success" ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : t.type === "error" ? (
                <XCircle className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </span>
            <p className="text-sm font-medium text-white leading-snug flex-1">{t.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="text-white/40 hover:text-white transition-colors shrink-0 cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

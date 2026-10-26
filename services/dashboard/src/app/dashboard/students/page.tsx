"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/components/ToastProvider";
import EnrollmentWizard from "@/components/EnrollmentWizard";
import {
  Users,
  Plus,
  Search,
  Eye,
  Pencil,
  Trash2,
  X,
  UserX,
  GraduationCap,
  Palette,
  CheckCircle2,
  XCircle,
  Power,
  Camera,
  UserRound,
  PhoneCall,
  RefreshCw,
  Upload,
  Image as ImageIcon,
  SwitchCamera,
} from "lucide-react";

interface Student {
  id: string;
  name: string;
  student_id: string | null;
  department: string | null;
  grade: string | null;
  section: string | null;
  uniform_type: string | null;
  photo_url: string | null;
  person_type: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const DEPARTMENTS = ["ALL", "CBMSD", "CICI", "COAG", "Education"];

const EDIT_PHOTO_LABELS = ["Front", "Left 45°", "Right 45°", "Up", "Down"] as const;
const MAX_EDIT_PHOTOS = 5;

interface EditPhoto {
  preview: string | null;
  file: File | null;
  keptUrl: string | null;
}

function emptyEditPhotos(): EditPhoto[] {
  return Array.from({ length: MAX_EDIT_PHOTOS }, () => ({
    preview: null,
    file: null,
    keptUrl: null,
  }));
}

function editPhotosFromUrls(urls: string[]): EditPhoto[] {
  const slots = emptyEditPhotos();
  urls.slice(0, MAX_EDIT_PHOTOS).forEach((url, i) => {
    slots[i] = { preview: url, file: null, keptUrl: url };
  });
  return slots;
}

function parsePhotos(photoUrl: string | null): string[] {
  if (!photoUrl) return [];
  try {
    const parsed = JSON.parse(photoUrl);
    if (Array.isArray(parsed)) return parsed.filter((p) => typeof p === "string");
    return [photoUrl];
  } catch {
    return [photoUrl];
  }
}

function formatUniformLabel(u?: string | null): string {
  if (!u || u === "default") return "Standard";
  return u
    .replace(/^(cici_|cbmsd_|coag_|edu_|education_)/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

export default function StudentsPage() {
  const router = useRouter();
  const { pushToast } = useToast();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [viewing, setViewing] = useState<Student | null>(null);
  const [editing, setEditing] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ─── Edit form state ────────────────────────────────
  const [editForm, setEditForm] = useState({
    name: "",
    student_id: "",
    department: "",
    grade: "",
    section: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editPhotos, setEditPhotos] = useState<EditPhoto[]>(emptyEditPhotos);
  const [editCameraIndex, setEditCameraIndex] = useState<number | null>(null);
  const editVideoRef = useRef<HTMLVideoElement>(null);
  const editCanvasRef = useRef<HTMLCanvasElement>(null);
  const editStreamRef = useRef<MediaStream | null>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const editUploadTargetRef = useRef<number>(0);
  const editCameraFacingRef = useRef<"user" | "environment">("user");

  const loadStudents = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    setLoading(true);
    setError("");
    const { data, error: queryError } = await supabase
      .from("students")
      .select("*")
      .order("created_at", { ascending: false });
    if (queryError) {
      setError(queryError.message);
    } else {
      setStudents(data ?? []);
    }
    setLoading(false);
  }, []);

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
      void loadStudents();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Actions ────────────────────────────────────────

  async function toggleActive(s: Student) {
    setBusyId(s.id);
    const supabase = getSupabase();
    if (!supabase) return;
    const { error: err } = await supabase
      .from("students")
      .update({ is_active: !s.is_active })
      .eq("id", s.id);
    if (err) {
      pushToast("error", err.message);
    } else {
      pushToast("success", `${s.name} ${s.is_active ? "deactivated" : "activated"}`);
      void loadStudents();
    }
    setBusyId(null);
  }

  async function deleteStudent() {
    if (!deleting) return;
    const supabase = getSupabase();
    if (!supabase) return;
    setBusyId(deleting.id);
    const { error: err } = await supabase.from("students").delete().eq("id", deleting.id);
    if (err) {
      pushToast("error", err.message);
    } else {
      pushToast("success", `${deleting.name} deleted`);
      setDeleting(null);
      if (viewing?.id === deleting.id) setViewing(null);
      void loadStudents();
    }
    setBusyId(null);
  }

  function openEdit(s: Student) {
    setEditing(s);
    setEditForm({
      name: s.name,
      student_id: s.student_id || "",
      department: s.department || "",
      grade: s.grade || "",
      section: s.section || "",
    });
    setEditPhotos(editPhotosFromUrls(parsePhotos(s.photo_url)));
    setEditCameraIndex(null);
  }

  function closeEdit() {
    editStreamRef.current?.getTracks().forEach((t) => t.stop());
    editStreamRef.current = null;
    setEditCameraIndex(null);
    setEditPhotos((prev) => {
      prev.forEach((p) => {
        if (p.file && p.preview) URL.revokeObjectURL(p.preview);
      });
      return prev;
    });
    setEditing(null);
  }

  function removeEditPhoto(slotIndex: number) {
    setEditPhotos((prev) => {
      const old = prev[slotIndex];
      if (old.file && old.preview) URL.revokeObjectURL(old.preview);
      return prev.map((p, i) =>
        i === slotIndex ? { preview: null, file: null, keptUrl: null } : p,
      );
    });
  }

  function openEditUpload(slotIndex: number) {
    editUploadTargetRef.current = slotIndex;
    editFileInputRef.current?.click();
  }

  function handleEditFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      pushToast("error", "Please choose an image file (JPG/PNG)");
      return;
    }
    const slotIndex = editUploadTargetRef.current;
    setEditPhotos((prev) => {
      const old = prev[slotIndex];
      if (old.file && old.preview) URL.revokeObjectURL(old.preview);
      return prev.map((p, i) =>
        i === slotIndex ? { preview: URL.createObjectURL(file), file, keptUrl: null } : p,
      );
    });
    event.target.value = "";
  }

  const startEditCamera = useCallback(
    async (slotIndex: number, facing: "user" | "environment" = editCameraFacingRef.current) => {
      try {
        editStreamRef.current?.getTracks().forEach((t) => t.stop());
        editStreamRef.current = null;
        editCameraFacingRef.current = facing;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: facing },
        });
        editStreamRef.current = stream;
        if (editVideoRef.current) editVideoRef.current.srcObject = stream;
        setEditCameraIndex(slotIndex);
      } catch {
        pushToast("error", "Camera unavailable — use Upload instead");
      }
    },
    [pushToast],
  );

  const stopEditCamera = useCallback(() => {
    editStreamRef.current?.getTracks().forEach((t) => t.stop());
    editStreamRef.current = null;
    setEditCameraIndex(null);
  }, []);

  useEffect(() => {
    if (editCameraIndex !== null && editVideoRef.current && editStreamRef.current) {
      editVideoRef.current.srcObject = editStreamRef.current;
    }
  }, [editCameraIndex]);

  useEffect(() => {
    return () => {
      editStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function captureEditPhoto() {
    if (editCameraIndex === null) return;
    const video = editVideoRef.current;
    const canvas = editCanvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File(
          [blob],
          `edit_${EDIT_PHOTO_LABELS[editCameraIndex].replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${Date.now()}.jpg`,
          {
            type: "image/jpeg",
          },
        );
        const previewUrl = URL.createObjectURL(blob);
        const slotIndex = editCameraIndex;
        setEditPhotos((prev) => {
          const old = prev[slotIndex];
          if (old.file && old.preview) URL.revokeObjectURL(old.preview);
          return prev.map((p, i) =>
            i === slotIndex ? { preview: previewUrl, file, keptUrl: null } : p,
          );
        });
        stopEditCamera();
      },
      "image/jpeg",
      0.85,
    );
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editForm.name.trim()) {
      pushToast("error", "Name is required");
      return;
    }
    const filledPhotos = editPhotos.filter((p) => p.preview !== null);
    if (filledPhotos.length === 0) {
      pushToast("error", "Keep at least one photo or add a new one");
      return;
    }
    setEditSaving(true);
    const supabase = getSupabase();
    if (!supabase) {
      setEditSaving(false);
      return;
    }
    try {
      const timestamp = Date.now();
      const photoUrls: string[] = [];
      for (let i = 0; i < editPhotos.length; i++) {
        const slot = editPhotos[i];
        if (!slot.preview) continue;
        if (slot.file) {
          const photoPath = `enrollments/${timestamp}_${editForm.student_id.trim() || editing.student_id || "edit"}_slot${i + 1}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from("student-photos")
            .upload(photoPath, slot.file);
          if (uploadError) throw uploadError;
          const { data: urlData } = supabase.storage.from("student-photos").getPublicUrl(photoPath);
          photoUrls.push(urlData?.publicUrl || photoPath);
        } else if (slot.keptUrl) {
          photoUrls.push(slot.keptUrl);
        }
      }
      const { error: err } = await supabase
        .from("students")
        .update({
          name: editForm.name.trim(),
          student_id: editForm.student_id.trim() || null,
          department: editForm.department || null,
          grade: editForm.grade || null,
          section: editForm.section || null,
          // The course IS the uniform: the kiosk accepts any uniform of the
          // course (blazer/female/male all verify a CICI student).
          uniform_type: editForm.department || "default",
          photo_url: JSON.stringify(photoUrls),
        })
        .eq("id", editing.id);
      if (err) throw err;
      pushToast("success", `${editForm.name} updated`);
      editStreamRef.current?.getTracks().forEach((t) => t.stop());
      editStreamRef.current = null;
      setEditCameraIndex(null);
      setEditing(null);
      void loadStudents();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setEditSaving(false);
    }
  }

  // ─── Filtering ──────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      const matchesSearch =
        q === "" ||
        s.name.toLowerCase().includes(q) ||
        s.student_id?.toLowerCase().includes(q) ||
        s.department?.toLowerCase().includes(q);
      const matchesDept =
        deptFilter === "ALL" || (s.department || "").toUpperCase() === deptFilter.toUpperCase();
      return matchesSearch && matchesDept;
    });
  }, [students, search, deptFilter]);

  const activeCount = students.filter((s) => s.is_active).length;

  return (
    <div>
      <EnrollmentWizard
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        onEnrolled={loadStudents}
      />

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-black text-surface-900 tracking-tight">
            Students
          </h1>
          <p className="text-surface-500 font-medium text-sm mt-1">
            {students.length} enrolled · {activeCount} active — manage profiles, uniforms & access
          </p>
        </div>
        <button
          onClick={() => setEnrollOpen(true)}
          className="btn-primary text-sm flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Enrollment
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm font-bold bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-surface-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, ID, or department..."
            className="input-field pl-10"
          />
        </div>
        <div className="flex gap-1.5 bg-white border border-surface-200 rounded-xl p-1 self-start">
          {DEPARTMENTS.map((d) => (
            <button
              key={d}
              onClick={() => setDeptFilter(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                deptFilter === d
                  ? "bg-primary-600 text-white shadow-sm"
                  : "text-surface-600 hover:bg-surface-50"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-surface-500 font-medium">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-16 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-surface-50 rounded-full flex items-center justify-center mb-4 border border-surface-100">
              <UserX className="w-10 h-10 text-surface-300" />
            </div>
            <h3 className="text-lg font-bold text-surface-900 mb-1">
              {search || deptFilter !== "ALL" ? "No matches found" : "No students enrolled"}
            </h3>
            <p className="text-surface-500 font-medium text-sm max-w-sm">
              {search || deptFilter !== "ALL"
                ? "Try adjusting your search or department filter."
                : "Get started by enrolling your first student — photos, uniform, and profile are captured in a guided 3-step flow."}
            </p>
            {!search && deptFilter === "ALL" && (
              <button
                onClick={() => setEnrollOpen(true)}
                className="mt-5 btn-primary text-sm flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Enroll first student
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50/50">
                  <th className="table-header">Student</th>
                  <th className="table-header">ID</th>
                  <th className="table-header">Course</th>
                  <th className="table-header">Year · Section</th>
                  <th className="table-header">Uniform</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Enrolled</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const photos = parsePhotos(s.photo_url);
                  return (
                    <tr
                      key={s.id}
                      className="border-b border-surface-50 hover:bg-surface-50 transition-colors"
                    >
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          {photos.length > 0 ? (
                            <img
                              src={photos[0]}
                              alt={s.name}
                              className="w-10 h-10 rounded-xl object-cover border border-surface-200 bg-surface-100"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-surface-100 border border-surface-200 flex items-center justify-center">
                              <UserRound className="w-5 h-5 text-surface-400" />
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-surface-900 text-sm">{s.name}</p>
                            {s.person_type === "staff" && (
                              <p className="text-[10px] font-bold text-violet-600 uppercase">
                                Staff
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="table-cell text-surface-500 font-mono font-medium text-xs">
                        {s.student_id || "—"}
                      </td>
                      <td className="table-cell text-surface-700 font-medium text-sm">
                        {s.department || "—"}
                      </td>
                      <td className="table-cell text-surface-600 font-medium text-xs">
                        {s.grade || "—"}
                        {s.section ? ` · ${s.section}` : ""}
                      </td>
                      <td className="table-cell">
                        <span className="px-2 py-1 bg-primary-50 text-primary-700 rounded-md text-xs font-bold">
                          {formatUniformLabel(s.uniform_type)}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span
                          className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 w-max ${
                            s.is_active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                          }`}
                        >
                          {s.is_active ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" /> Active
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3" /> Inactive
                            </>
                          )}
                        </span>
                      </td>
                      <td className="table-cell text-surface-500 font-medium text-xs">
                        {formatDate(s.created_at)}
                      </td>
                      <td className="table-cell">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => setViewing(s)}
                            title="View profile"
                            className="p-2 rounded-lg bg-surface-50 hover:bg-primary-50 text-surface-500 hover:text-primary-600 transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openEdit(s)}
                            title="Edit"
                            className="p-2 rounded-lg bg-surface-50 hover:bg-primary-50 text-surface-500 hover:text-primary-600 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleActive(s)}
                            disabled={busyId === s.id}
                            title={s.is_active ? "Deactivate" : "Activate"}
                            className={`p-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                              s.is_active
                                ? "bg-amber-50 text-amber-600 hover:bg-amber-100"
                                : "bg-green-50 text-green-600 hover:bg-green-100"
                            }`}
                          >
                            <Power className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleting(s)}
                            title="Delete"
                            className="p-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── View modal ─── */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-surface-900/40 backdrop-blur-sm"
            onClick={() => setViewing(null)}
          />
          <div className="relative w-full max-w-2xl max-h-[90vh] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-surface-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary-50 border border-primary-100 flex items-center justify-center">
                  <Users className="w-6 h-6 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-surface-900">{viewing.name}</h2>
                  <p className="text-xs font-medium text-surface-500">
                    Student profile · enrolled {formatDate(viewing.created_at)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewing(null)}
                className="p-2 hover:bg-surface-100 rounded-full transition-colors text-surface-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Photos */}
              <div>
                <h3 className="text-sm font-bold text-surface-900 mb-3 flex items-center gap-2">
                  <Camera className="w-4 h-4 text-primary-500" />
                  Enrollment Photos ({parsePhotos(viewing.photo_url).length})
                </h3>
                {parsePhotos(viewing.photo_url).length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {parsePhotos(viewing.photo_url).map((p, i) => (
                      <img
                        key={i}
                        src={p}
                        alt={`${viewing.name} photo ${i + 1}`}
                        className="w-full aspect-[4/3] object-cover rounded-xl border border-surface-200"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="p-8 bg-surface-50 rounded-xl text-center text-sm font-medium text-surface-400 border border-dashed border-surface-200">
                    No photos on file
                  </div>
                )}
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  {
                    icon: <UserRound className="w-4 h-4" />,
                    label: "Student ID",
                    value: viewing.student_id || "—",
                  },
                  {
                    icon: <GraduationCap className="w-4 h-4" />,
                    label: "Course",
                    value: viewing.department || "—",
                  },
                  {
                    icon: <Users className="w-4 h-4" />,
                    label: "Year Level",
                    value: viewing.grade || "—",
                  },
                  {
                    icon: <Users className="w-4 h-4" />,
                    label: "Section",
                    value: viewing.section || "—",
                  },
                  {
                    icon: <Palette className="w-4 h-4" />,
                    label: "Uniform",
                    value: formatUniformLabel(viewing.uniform_type),
                  },
                  {
                    icon: <PhoneCall className="w-4 h-4" />,
                    label: "Person Type",
                    value: viewing.person_type || "student",
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="bg-surface-50 border border-surface-100 rounded-xl p-4"
                  >
                    <p className="text-[10px] font-black uppercase tracking-wider text-surface-400 flex items-center gap-1.5 mb-1">
                      {row.icon}
                      {row.label}
                    </p>
                    <p className="text-sm font-bold text-surface-900">{row.value}</p>
                  </div>
                ))}
              </div>

              <div
                className={`px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2 border ${
                  viewing.is_active
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-red-50 border-red-200 text-red-600"
                }`}
              >
                {viewing.is_active ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                {viewing.is_active
                  ? "Active — recognized at kiosks on next sync"
                  : "Inactive — access revoked at kiosks on next sync"}
              </div>
            </div>

            <div className="p-6 border-t border-surface-100 flex justify-end gap-2">
              <button
                onClick={() => setViewing(null)}
                className="px-4 py-2.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-xl text-sm font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => {
                  const s = viewing;
                  setViewing(null);
                  openEdit(s);
                }}
                className="px-4 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Pencil className="w-4 h-4" />
                Edit Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edit modal ─── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <canvas ref={editCanvasRef} className="hidden" />
          <input
            ref={editFileInputRef}
            type="file"
            accept="image/*"
            onChange={handleEditFileSelected}
            className="hidden"
          />
          {editCameraIndex !== null && (
            <div className="fixed inset-0 z-[60] bg-black">
              <video
                ref={editVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute top-0 inset-x-0 p-6 pb-16 bg-gradient-to-b from-black/80 to-transparent text-center pointer-events-none">
                <p className="text-white text-lg sm:text-2xl font-bold drop-shadow">
                  Retake — {EDIT_PHOTO_LABELS[editCameraIndex]}
                </p>
                <p className="text-white/70 text-sm mt-1 drop-shadow">
                  Align the face, then capture
                </p>
              </div>
              <div className="absolute bottom-0 inset-x-0 p-8 pt-16 bg-gradient-to-t from-black/80 to-transparent">
                <div className="flex items-end justify-center gap-6">
                  <button
                    onClick={stopEditCamera}
                    className="px-6 py-3 bg-white/10 hover:bg-white/20 backdrop-blur border border-white/30 text-white rounded-full transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                    Cancel
                  </button>
                  <button
                    onClick={captureEditPhoto}
                    className="w-20 h-20 rounded-full border-4 border-white bg-white/20 backdrop-blur hover:bg-white/30 transition-all flex items-center justify-center cursor-pointer"
                    aria-label="Capture photo"
                  >
                    <span className="w-14 h-14 rounded-full bg-white shadow-lg" />
                  </button>
                  <button
                    onClick={() => {
                      if (editCameraIndex === null) return;
                      const next = editCameraFacingRef.current === "user" ? "environment" : "user";
                      void startEditCamera(editCameraIndex, next);
                    }}
                    className="px-5 py-3 bg-white/10 hover:bg-white/20 backdrop-blur border border-white/30 text-white rounded-full transition-colors flex items-center gap-2 cursor-pointer"
                    aria-label="Switch camera"
                  >
                    <SwitchCamera className="w-5 h-5" />
                    Flip
                  </button>
                </div>
              </div>
            </div>
          )}
          <div
            className="absolute inset-0 bg-surface-900/40 backdrop-blur-sm"
            onClick={closeEdit}
          />
          <div className="relative w-full max-w-2xl max-h-[90vh] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-surface-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
                <Pencil className="w-5 h-5 text-primary-500" />
                Edit Student
              </h2>
              <button
                onClick={closeEdit}
                className="p-2 hover:bg-surface-100 rounded-full transition-colors text-surface-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div>
                <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="input-field"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                    Student ID
                  </label>
                  <input
                    type="text"
                    value={editForm.student_id}
                    onChange={(e) => setEditForm((f) => ({ ...f, student_id: e.target.value }))}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm text-surface-700 mb-1.5 font-bold">Course</label>
                  <select
                    value={editForm.department}
                    onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
                    className="input-field"
                  >
                    <option value="">—</option>
                    {DEPARTMENTS.filter((d) => d !== "ALL").map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-surface-700 mb-1.5 font-bold">
                    Year Level
                  </label>
                  <select
                    value={editForm.grade}
                    onChange={(e) => setEditForm((f) => ({ ...f, grade: e.target.value }))}
                    className="input-field"
                  >
                    <option value="">—</option>
                    {["1st Year", "2nd Year", "3rd Year", "4th Year"].map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-surface-700 mb-1.5 font-bold">Section</label>
                  <select
                    value={editForm.section}
                    onChange={(e) => setEditForm((f) => ({ ...f, section: e.target.value }))}
                    className="input-field"
                  >
                    <option value="">—</option>
                    {["A", "B", "C", "D"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {editForm.department && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-primary-50 border border-primary-100 text-xs font-bold text-primary-800">
                  <CheckCircle2 className="w-4 h-4 text-primary-600 shrink-0" />
                  Uniform: any {editForm.department} uniform is accepted automatically at the kiosk
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-surface-900 flex items-center gap-2">
                    <Camera className="w-4 h-4 text-primary-500" />
                    Enrollment Photos ({editPhotos.filter((p) => p.preview).length}/
                    {MAX_EDIT_PHOTOS})
                  </h3>
                  <span className="text-[11px] font-medium text-surface-400">
                    Retake, replace, or remove — at least 1 required
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {editPhotos.map((photo, index) => {
                    const isFilled = photo.preview !== null;
                    return (
                      <div key={index} className="flex flex-col items-center">
                        <div
                          className={`w-full aspect-[4/3] rounded-xl border-2 flex items-center justify-center overflow-hidden ${
                            isFilled
                              ? "border-green-500/50 bg-green-500/5"
                              : "border-dashed border-surface-300 bg-surface-50"
                          }`}
                        >
                          {photo.preview ? (
                            <img
                              src={photo.preview}
                              alt={`${EDIT_PHOTO_LABELS[index]} photo`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="text-center p-2">
                              <Camera className="w-5 h-5 text-surface-300 mx-auto mb-1" />
                              <p className="text-surface-500 font-medium text-[11px]">
                                {EDIT_PHOTO_LABELS[index]}
                              </p>
                            </div>
                          )}
                        </div>
                        <p className="text-[11px] font-bold text-surface-600 mt-1.5">
                          {EDIT_PHOTO_LABELS[index]}
                        </p>
                        <div className="flex gap-1.5 mt-1.5 flex-wrap justify-center">
                          {isFilled ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void startEditCamera(index)}
                                title="Retake with camera"
                                className="text-[11px] px-2.5 py-1.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" />
                                Retake
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditUpload(index)}
                                title="Upload a new photo"
                                className="text-[11px] px-2.5 py-1.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                {photo.file ? (
                                  <ImageIcon className="w-3 h-3" />
                                ) : (
                                  <Upload className="w-3 h-3" />
                                )}
                                {photo.file ? "Replace" : "Upload"}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeEditPhoto(index)}
                                title="Remove this photo"
                                className="text-[11px] px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 font-medium rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                                Remove
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => void startEditCamera(index)}
                                className="text-[11px] px-2.5 py-1.5 bg-primary-50 hover:bg-primary-100 text-primary-700 font-medium rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              >
                                <Camera className="w-3 h-3" />
                                Take
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditUpload(index)}
                                className="text-[11px] px-2.5 py-1.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
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
              </div>
            </div>

            <div className="p-6 border-t border-surface-100 flex justify-end gap-2">
              <button
                onClick={closeEdit}
                className="px-4 py-2.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-xl text-sm font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {editSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete confirm ─── */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-surface-900/40 backdrop-blur-sm"
            onClick={() => setDeleting(null)}
          />
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
                <Trash2 className="w-7 h-7 text-red-500" />
              </div>
              <h2 className="text-lg font-bold text-surface-900 mb-1">Delete student?</h2>
              <p className="text-sm font-medium text-surface-500">
                <span className="font-bold text-surface-900">{deleting.name}</span> will be
                permanently removed and lose access at all kiosks. This cannot be undone.
              </p>
            </div>
            <div className="p-6 pt-0 flex gap-2 justify-center">
              <button
                onClick={() => setDeleting(null)}
                className="px-5 py-2.5 bg-white border border-surface-200 hover:bg-surface-50 text-surface-700 rounded-xl text-sm font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={deleteStudent}
                disabled={busyId === deleting.id}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {busyId === deleting.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

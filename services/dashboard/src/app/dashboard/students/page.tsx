"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editForm.name.trim()) {
      pushToast("error", "Name is required");
      return;
    }
    setEditSaving(true);
    const supabase = getSupabase();
    if (!supabase) return;
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
      })
      .eq("id", editing.id);
    if (err) {
      pushToast("error", err.message);
    } else {
      pushToast("success", `${editForm.name} updated`);
      setEditing(null);
      void loadStudents();
    }
    setEditSaving(false);
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
                  <div className="grid grid-cols-3 gap-3">
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
          <div
            className="absolute inset-0 bg-surface-900/40 backdrop-blur-sm"
            onClick={() => setEditing(null)}
          />
          <div className="relative w-full max-w-lg max-h-[90vh] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-surface-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
                <Pencil className="w-5 h-5 text-primary-500" />
                Edit Student
              </h2>
              <button
                onClick={() => setEditing(null)}
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
            </div>

            <div className="p-6 border-t border-surface-100 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
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

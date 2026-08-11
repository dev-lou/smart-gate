"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { Users, Plus, UserX } from "lucide-react";

interface Student {
  id: string;
  name: string;
  student_id: string | null;
  department: string | null;
  grade: string | null;
  section: string | null;
  uniform_type: string | null;
  photo_url: string | null;
  is_active: boolean;
  created_at: string;
}

export default function StudentsPage() {
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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
    loadStudents();
  }, []);

  async function loadStudents() {
    const supabase = getSupabase();
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase
      .from("students")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setStudents(data);
    setLoading(false);
  }

  async function toggleActive(id: string, current: boolean) {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from("students").update({ is_active: !current }).eq("id", id);
    loadStudents();
  }

  async function deleteStudent(id: string) {
    const supabase = getSupabase();
    if (!supabase) return;
    if (!confirm("Delete this student record?")) return;
    await supabase.from("students").delete().eq("id", id);
    loadStudents();
  }

  const filtered = search
    ? students.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.student_id?.toLowerCase().includes(search.toLowerCase()) ||
          s.department?.toLowerCase().includes(search.toLowerCase()),
      )
    : students;

  return (
    <div className="min-h-screen p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-surface-200 flex items-center justify-center">
            <Users className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-900">Students</h1>
            <p className="text-surface-500 font-medium text-sm mt-1">{students.length} enrolled students</p>
          </div>
        </div>
        <a
          href="http://localhost:3001"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary text-sm flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Enrollment
        </a>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, ID, or department..."
          className="input-field max-w-md"
        />
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
              {search ? "No matches found" : "No students enrolled"}
            </h3>
            <p className="text-surface-500 font-medium text-sm max-w-sm">
              {search ? "Try adjusting your search terms to find what you're looking for." : "Get started by enrolling your first student into the system."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50/50">
                  <th className="table-header">Name</th>
                  <th className="table-header">ID</th>
                  <th className="table-header">Department</th>
                  <th className="table-header">Uniform</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Enrolled</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-surface-50 hover:bg-surface-50 transition-colors"
                  >
                    <td className="table-cell font-bold text-surface-900">{s.name}</td>
                    <td className="table-cell text-surface-500 font-mono font-medium text-xs">
                      {s.student_id || "—"}
                    </td>
                    <td className="table-cell text-surface-700 font-medium">{s.department || "—"}</td>
                    <td className="table-cell">
                      <span className="px-2 py-1 bg-primary-50 text-primary-700 rounded-md text-xs font-bold">
                        {s.uniform_type || "default"}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span
                        className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 w-max ${
                          s.is_active
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {s.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="table-cell text-surface-500 font-medium text-xs">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="table-cell">
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleActive(s.id, s.is_active)}
                          className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-colors ${
                            s.is_active
                              ? "bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                              : "bg-green-50 text-green-700 hover:bg-green-100"
                          }`}
                        >
                          {s.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => deleteStudent(s.id)}
                          className="text-xs px-3 py-1.5 rounded-lg font-bold bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

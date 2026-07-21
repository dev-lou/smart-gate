"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

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
    <div className="min-h-screen bg-surface-950 p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">👥 Students</h1>
          <p className="text-surface-400 text-sm mt-1">{students.length} enrolled students</p>
        </div>
        <a
          href="http://localhost:3001"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary text-sm"
        >
          + New Enrollment
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
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-surface-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-surface-400">
            {search ? "No students match your search" : "No students enrolled yet"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-800">
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
                    className="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors"
                  >
                    <td className="table-cell font-medium text-white">{s.name}</td>
                    <td className="table-cell text-surface-400 font-mono text-xs">
                      {s.student_id || "—"}
                    </td>
                    <td className="table-cell">{s.department || "—"}</td>
                    <td className="table-cell">
                      <span className="px-2 py-1 bg-primary-600/10 text-primary-400 rounded-md text-xs font-medium">
                        {s.uniform_type || "default"}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span
                        className={`px-2 py-1 rounded-md text-xs font-medium ${
                          s.is_active
                            ? "bg-green-500/10 text-green-400"
                            : "bg-red-500/10 text-red-400"
                        }`}
                      >
                        {s.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="table-cell text-surface-400 text-xs">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="table-cell">
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleActive(s.id, s.is_active)}
                          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                            s.is_active
                              ? "bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20"
                              : "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                          }`}
                        >
                          {s.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => deleteStudent(s.id)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
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

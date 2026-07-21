"use client";

import { useEffect, useState, useCallback } from "react";
import { Student } from "@/types";
import StudentForm from "@/components/StudentForm";
import StudentList from "@/components/StudentList";

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(
    null,
  );

  const fetchStudents = useCallback(async () => {
    try {
      const res = await fetch("/api/students");
      const data = await res.json();
      setStudents(data.students || []);
    } catch (err) {
      console.error("Failed to fetch students:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const handleSubmit = async (formData: FormData) => {
    setFormLoading(true);
    setMessage(null);
    try {
      const method = editingStudent ? "PUT" : "POST";
      const res = await fetch("/api/students", { method, body: formData });
      const data = await res.json();

      if (res.ok) {
        setMessage({
          type: "success",
          text: editingStudent ? "Student updated!" : "Student added!",
        });
        setShowForm(false);
        setEditingStudent(null);
        fetchStudents();
      } else {
        setMessage({ type: "error", text: data.error || "Operation failed" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/students?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setMessage({ type: "success", text: "Student deactivated" });
        fetchStudents();
      }
    } catch {
      setMessage({ type: "error", text: "Failed to deactivate student" });
    }
  };

  const handleEdit = (student: Student) => {
    setEditingStudent(student);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
            Students
          </h1>
          <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
            {students.length} enrolled student{students.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingStudent(null);
            setShowForm(!showForm);
          }}
          className="btn-primary"
        >
          {showForm ? "Close" : "Add Student"}
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div
          className={`p-4 rounded-xl animate-slide-up ${
            message.type === "success"
              ? "bg-success-50 dark:bg-success-950/40 border border-success-200 dark:border-success-800 text-success-700 dark:text-success-300"
              : "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="glass-card p-6 animate-slide-up">
          <h2 className="text-lg font-semibold mb-5">
            {editingStudent
              ? `Edit: ${editingStudent.name}`
              : "Add New Student"}
          </h2>
          <StudentForm
            onSubmit={handleSubmit}
            initialData={
              editingStudent
                ? {
                    name: editingStudent.name,
                    department: editingStudent.department || "",
                    grade: editingStudent.grade || "",
                    section: editingStudent.section || "",
                    uniform_type: editingStudent.uniform_type || "default",
                    photo_url: editingStudent.photo_url || null,
                  }
                : undefined
            }
            mode="student"
            studentId={editingStudent?.id}
            loading={formLoading}
            onCancel={() => {
              setShowForm(false);
              setEditingStudent(null);
            }}
          />
        </div>
      )}

      {/* Student List */}
      <div className="glass-card p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 rounded-full animate-spin" />
          </div>
        ) : (
          <StudentList
            students={students}
            mode="student"
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}

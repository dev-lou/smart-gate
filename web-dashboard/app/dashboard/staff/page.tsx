"use client";

import { useCallback, useEffect, useState } from "react";
import { Student } from "@/types";
import StudentForm from "@/components/StudentForm";
import StudentList from "@/components/StudentList";

export default function StaffPage() {
  const [staff, setStaff] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Student | null>(null);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  const fetchStaff = useCallback(async () => {
    try {
      const res = await fetch("/api/staff");
      const data = await res.json();
      setStaff(data.students || []);
    } catch (err) {
      console.error("Failed to fetch staff:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const handleSubmit = async (formData: FormData) => {
    setFormLoading(true);
    setMessage(null);
    try {
      const method = editingStaff ? "PUT" : "POST";
      const res = await fetch("/api/staff", { method, body: formData });
      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: editingStaff ? "Staff updated!" : "Staff added!" });
        setShowForm(false);
        setEditingStaff(null);
        fetchStaff();
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
      const res = await fetch(`/api/staff?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setMessage({ type: "success", text: "Staff deactivated" });
        fetchStaff();
      }
    } catch {
      setMessage({ type: "error", text: "Failed to deactivate staff" });
    }
  };

  const handleEdit = (person: Student) => {
    setEditingStaff(person);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
            Staff
          </h1>
          <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
            {staff.length} enrolled staff member{staff.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingStaff(null);
            setShowForm(!showForm);
          }}
          className="btn-primary"
        >
          {showForm ? "Close" : "Add Staff"}
        </button>
      </div>

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

      {showForm && (
        <div className="glass-card p-6 animate-slide-up">
          <h2 className="text-lg font-semibold mb-5">
            {editingStaff ? `Edit: ${editingStaff.name}` : "Add New Staff"}
          </h2>
          <StudentForm
            onSubmit={handleSubmit}
            initialData={
              editingStaff
                ? {
                    name: editingStaff.name,
                    department: editingStaff.department || "",
                    photo_url: editingStaff.photo_url || null,
                  }
                : undefined
            }
            mode="staff"
            studentId={editingStaff?.id}
            loading={formLoading}
            onCancel={() => {
              setShowForm(false);
              setEditingStaff(null);
            }}
          />
        </div>
      )}

      <div className="glass-card p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 rounded-full animate-spin" />
          </div>
        ) : (
          <StudentList students={staff} mode="staff" onEdit={handleEdit} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { DEPARTMENT_OPTIONS, DEPARTMENT_TO_UNIFORM, StudentFormData } from "@/types";
import CustomSelect from "./CustomSelect";

type PersonFormMode = "student" | "faculty" | "staff";

interface StudentFormProps {
  onSubmit: (data: FormData) => Promise<void>;
  initialData?: Partial<StudentFormData> & { photo_url?: string | null };
  mode?: PersonFormMode;
  studentId?: string;
  loading?: boolean;
  onCancel?: () => void;
}

export default function StudentForm({
  onSubmit,
  initialData,
  mode = "student",
  studentId,
  loading = false,
  onCancel,
}: StudentFormProps) {
  const [name, setName] = useState(initialData?.name || "");
  const [department, setDepartment] = useState(initialData?.department || "");
  const [grade, setGrade] = useState(initialData?.grade || "");
  const [section, setSection] = useState(initialData?.section || "");
  // Auto-assign uniform_type based on department for students
  const getUniformType = (dept: string) => {
    if (!dept) return "";
    return DEPARTMENT_TO_UNIFORM[dept] || "";
  };

  const [uniformType, setUniformType] = useState(
    initialData?.uniform_type || getUniformType(initialData?.department || ""),
  );
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initialData?.photo_url || null,
  );

  const isStudent = mode === "student";
  const label =
    mode === "faculty" ? "Faculty" : mode === "staff" ? "Staff" : "Student";

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setPhoto(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(initialData?.photo_url || null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    if (studentId) formData.append("id", studentId);
    formData.append("name", name);
    formData.append("department", department);
    if (isStudent) {
      formData.append("grade", grade);
      formData.append("section", section);
      formData.append("uniform_type", uniformType);
    }
    if (photo) formData.append("photo", photo);
    await onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label htmlFor="person-name" className="input-label">
            Full Name *
          </label>
          <input
            id="person-name"
            className="input-field"
            placeholder="Juan Dela Cruz"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label htmlFor="person-department" className="input-label">
            {isStudent ? "Department" : "Office / Department"}
          </label>
          {isStudent ? (
            <CustomSelect
              options={DEPARTMENT_OPTIONS.map((dep) => ({ label: dep, value: dep }))}
              value={department ? { label: department, value: department } : null}
              onChange={(option) => {
                const newDept = option?.value || "";
                setDepartment(newDept);
                // Auto-assign uniform type when department changes (students only)
                setUniformType(getUniformType(newDept));
              }}
              placeholder="Select department"
              isClearable={true}
            />
          ) : (
            <input
              id="person-department"
              className="input-field"
              placeholder="Office or department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          )}
        </div>

        {isStudent && (
          <>
            <div>
              <label htmlFor="student-grade" className="input-label">
                Grade / Year
              </label>
              <input
                id="student-grade"
                className="input-field"
                placeholder="Grade 10 / 1st Year"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="student-section" className="input-label">
                Section
              </label>
              <input
                id="student-section"
                className="input-field"
                placeholder="Section A"
                value={section}
                onChange={(e) => setSection(e.target.value)}
              />
            </div>
            <div>
              <label className="input-label">
                Required Uniform (Auto-assigned)
              </label>
              <input
                className="input-field bg-surface-100 dark:bg-surface-800 cursor-not-allowed"
                value={uniformType ? `${uniformType} Uniform` : "Select department first"}
                disabled
                readOnly
              />
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                Uniform is automatically assigned based on department for YOLO11 detection
              </p>
            </div>
          </>
        )}

      </div>

      <div>
        <label htmlFor="person-photo" className="input-label">
          Photo
        </label>
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <div className="flex-shrink-0">
            {previewUrl ? (
              <div className="relative group">
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-24 h-24 rounded-xl object-cover border-2 border-primary-300 dark:border-primary-700 shadow-sm"
                />
                {photo && (
                  <div className="absolute inset-0 rounded-xl bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-white text-xs font-medium">New</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-24 h-24 rounded-xl bg-surface-200 dark:bg-surface-800 border-2 border-dashed border-surface-400 dark:border-surface-600 flex flex-col items-center justify-center">
                <svg
                  className="w-8 h-8 text-surface-400 dark:text-surface-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                <span className="text-surface-500 dark:text-surface-400 text-xs mt-1">No photo</span>
              </div>
            )}
          </div>

          <div className="flex-1">
            <input
              id="person-photo"
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              className="input-field file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary-100 dark:file:bg-primary-900/30 file:text-primary-700 dark:file:text-primary-400 file:font-medium file:text-sm file:cursor-pointer hover:file:bg-primary-200 dark:hover:file:bg-primary-900/50 w-full"
            />
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-2">
              Upload a clear front-facing photo for face recognition
              enrollment.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="btn-primary disabled:opacity-50"
        >
          {loading
            ? "Saving..."
            : studentId
              ? `Update ${label}`
              : `Add ${label}`}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

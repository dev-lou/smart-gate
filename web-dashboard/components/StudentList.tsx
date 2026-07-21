"use client";

import { Student } from "@/types";

interface StudentListProps {
  students: Student[];
  mode?: "student" | "faculty" | "staff";
  onEdit: (student: Student) => void;
  onDelete: (id: string) => void;
}

export default function StudentList({
  students,
  mode = "student",
  onEdit,
  onDelete,
}: StudentListProps) {
  const entityLabel =
    mode === "faculty" ? "faculty" : mode === "staff" ? "staff" : "students";
  const entitySingular =
    mode === "faculty"
      ? "faculty member"
      : mode === "staff"
        ? "staff member"
        : "student";
  if (students.length === 0) {
    return (
      <div className="text-center py-16">
        <svg
          className="w-16 h-16 mx-auto text-surface-400 dark:text-surface-600 mb-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
        <p className="text-surface-500 dark:text-surface-400 text-lg">
          No {entityLabel} enrolled yet
        </p>
        <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
          Add your first {entitySingular} above
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>
              {mode === "faculty"
                ? "Faculty"
                : mode === "staff"
                  ? "Staff"
                  : "Student"}
            </th>
            <th>{mode === "student" ? "Department" : "Office / Department"}</th>
            {mode === "student" && <th>Grade</th>}
            {mode === "student" && <th>Uniform</th>}
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.id} className="group">
              <td>
                <div className="flex items-center gap-3">
                  {student.photo_url ? (
                    <img
                      src={student.photo_url}
                      alt={student.name}
                      className="w-10 h-10 rounded-xl object-cover border border-surface-300 dark:border-surface-700"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center border border-surface-300 dark:border-surface-700">
                      <span className="text-primary-600 dark:text-primary-400 font-bold text-sm">
                        {student.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-surface-900 dark:text-white">{student.name}</p>
                    {mode === "student" && student.section && (
                      <p className="text-xs text-surface-500 dark:text-surface-400">
                        {student.section}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="text-surface-500 dark:text-surface-400">{student.department || "—"}</td>
              {mode === "student" && (
                <td className="text-surface-500 dark:text-surface-400">{student.grade || "—"}</td>
              )}
              {mode === "student" && (
                <td>
                  <span className="badge badge-info">
                    {student.uniform_type || "default"}
                  </span>
                </td>
              )}
              <td>
                <span
                  className={`badge ${student.is_active ? "badge-success" : "badge-danger"}`}
                >
                  {student.is_active ? "Active" : "Inactive"}
                </span>
              </td>
              <td>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onEdit(student)}
                    className="p-2 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/20 text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                    title="Edit"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Deactivate ${student.name}?`)) {
                        onDelete(student.id);
                      }
                    }}
                    className="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 text-surface-500 dark:text-surface-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    title="Deactivate"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

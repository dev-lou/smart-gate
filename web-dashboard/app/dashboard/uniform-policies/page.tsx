"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { DEPARTMENT_OPTIONS, UNIFORM_OPTIONS, DEPARTMENT_TO_UNIFORM } from "@/types";
import CustomSelect from "@/components/CustomSelect";

type Policy = {
  department: string;
  uniform_type: string;
  description?: string;
};

export default function UniformPoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [department, setDepartment] = useState(DEPARTMENT_OPTIONS[0] || "");
  const [customDepartment, setCustomDepartment] = useState("");
  const [uniformType, setUniformType] = useState("default");
  const [description, setDescription] = useState("");
  const [yoloModelPath, setYoloModelPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    try {
      // Load policies
      const res = await fetch("/api/settings?key=department_uniform_policies");
      if (res.status === 404) {
        setPolicies([]);
      } else {
        const data = await res.json();
        const parsed = JSON.parse(data.value || "[]");
        setPolicies(Array.isArray(parsed) ? parsed : []);
      }
      // Load YOLO model path
      const yoloRes = await fetch("/api/settings?key=yolo_model_path");
      if (yoloRes.ok) {
        const yoloData = await yoloRes.json();
        setYoloModelPath(yoloData.value || "");
      }
    } catch (error) {
      console.error("Failed to load uniform policies:", error);
      setMessage({ type: "error", text: "Failed to load uniform policies" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  const savePolicies = async (nextPolicies: Policy[]) => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "department_uniform_policies",
        value: JSON.stringify(nextPolicies),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to save policies");
    }
  };

  const saveYoloModelPath = async () => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "yolo_model_path",
        value: yoloModelPath,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to save YOLO model path");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selectedDepartment = (customDepartment || department).trim();
    if (!selectedDepartment) {
      setMessage({ type: "error", text: "Department is required" });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const nextPolicies = [
        ...policies.filter((policy) => policy.department !== selectedDepartment),
        { department: selectedDepartment, uniform_type: uniformType, description },
      ].sort((a, b) => a.department.localeCompare(b.department));

      await savePolicies(nextPolicies);
      setPolicies(nextPolicies);
      setCustomDepartment("");
      setDescription("");
      setMessage({ type: "success", text: "Uniform policy saved" });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to save uniform policy",
      });
    } finally {
      setSaving(false);
    }
  };

  const removePolicy = async (policy: Policy) => {
    if (!confirm(`Remove uniform policy for ${policy.department}?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      const nextPolicies = policies.filter((item) => item.department !== policy.department);
      await savePolicies(nextPolicies);
      setPolicies(nextPolicies);
      setMessage({ type: "success", text: "Uniform policy removed" });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to remove uniform policy",
      });
    } finally {
      setSaving(false);
    }
  };

  const uniformLabel = (value: string) => {
    return UNIFORM_OPTIONS.find((item) => item.value === value)?.label || value;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
          Uniform Policies
        </h1>
        <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">
          Map each department to the prescribed uniform type checked during student entry.
        </p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl ${
            message.type === "success"
              ? "bg-success-50 dark:bg-success-950/40 border border-success-200 dark:border-success-800 text-success-700 dark:text-success-300"
              : "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-5">Add or Update Policy</h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label className="input-label">Department</label>
              <CustomSelect
                options={DEPARTMENT_OPTIONS.map((dep) => ({ label: dep, value: dep }))}
                value={department ? { label: department, value: department } : null}
                onChange={(option) => setDepartment(option?.value || "")}
                placeholder="Select department"
                disabled={Boolean(customDepartment)}
              />
            </div>
            <div>
              <label className="input-label">Custom Department</label>
              <input
                className="input-field"
                value={customDepartment}
                onChange={(e) => setCustomDepartment(e.target.value)}
                placeholder="Optional custom value"
              />
            </div>
            <div>
              <label className="input-label">Prescribed Uniform</label>
              <CustomSelect
                options={UNIFORM_OPTIONS.map((uniform) => ({ label: uniform.label, value: uniform.value }))}
                value={uniformType ? { label: UNIFORM_OPTIONS.find(u => u.value === uniformType)?.label || uniformType, value: uniformType } : null}
                onChange={(option) => setUniformType(option?.value || "")}
                placeholder="Select uniform"
              />
            </div>
          </div>
          <div>
            <label className="input-label">Description</label>
            <input
              className="input-field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes about this uniform rule"
            />
          </div>
          <button disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? "Saving..." : "Save Policy"}
          </button>
        </form>
      </div>

      {/* YOLO Model Configuration */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-4">Global Uniform YOLO Model (.pt)</h2>
        <div className="space-y-4">
          <div>
            <label className="input-label">Model Path</label>
            <input
              className="input-field"
              value={yoloModelPath}
              onChange={(e) => setYoloModelPath(e.target.value)}
              placeholder="e.g., models/yolo11n_uniform.pt or /path/to/your/model.pt"
            />
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
              Path to your custom YOLO11 nano model trained to detect all department uniforms (e.g. IT, Nursing, etc.).
            </p>
          </div>
          <div className="flex justify-end">
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  await saveYoloModelPath();
                  setMessage({ type: "success", text: "YOLO model path saved successfully" });
                } catch (error) {
                  setMessage({ type: "error", text: "Failed to save YOLO model path" });
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Model Path"}
            </button>
          </div>
        </div>
      </div>

      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Department Policies</h2>
          <button onClick={loadPolicies} className="btn-secondary text-sm">
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 rounded-full animate-spin" />
          </div>
        ) : policies.length === 0 ? (
          <p className="text-surface-500 text-center py-12">No uniform policies configured yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Uniform Type</th>
                  <th>Description</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.department}>
                    <td className="font-medium text-surface-900 dark:text-white">{policy.department}</td>
                    <td>
                      <span className="badge badge-info">{uniformLabel(policy.uniform_type)}</span>
                    </td>
                    <td className="text-surface-500 dark:text-surface-400 text-sm">{policy.description || "—"}</td>
                    <td>
                      <button
                        onClick={() => removePolicy(policy)}
                        className="btn-danger text-xs py-1.5 px-3"
                        disabled={saving}
                      >
                        Remove
                      </button>
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

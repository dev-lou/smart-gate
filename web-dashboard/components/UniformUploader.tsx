"use client";

import { useEffect, useState } from "react";
import Swal from "sweetalert2";

interface UniformUploaderProps {
  label: string;
  settingKey: string;
  initialUrl: string;
  description: string;
  onUpload: (key: string, file: File) => Promise<string | void>;
}

export default function UniformUploader({
  label,
  settingKey,
  initialUrl,
  description,
  onUpload,
}: UniformUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl || null);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(initialUrl || null);
    }
  }, [initialUrl, photo]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setPhoto(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(initialUrl || null);
    }
  };

  const handleSaveBtn = async () => {
    if (!photo) return;
    setUploading(true);
    try {
      const msg = await onUpload(settingKey, photo);
      setPhoto(null); // Clear the 'new file' selection on success

      await Swal.fire({
        title: "Reference Saved",
        text: typeof msg === "string" && msg ? msg : "Reference image and display name saved successfully.",
        icon: "success",
        confirmButtonText: "OK",
        confirmButtonColor: "#2563eb",
      });

      // User requested an automatic refresh after acknowledging success.
      window.location.reload();
    } catch (e) {
      console.error(e);
      await Swal.fire({
        title: "Save Failed",
        text: e instanceof Error ? e.message : "Failed to upload reference image.",
        icon: "error",
        confirmButtonText: "OK",
        confirmButtonColor: "#dc2626",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row md:items-start gap-4 py-4 border-b border-surface-300 dark:border-surface-700 last:border-0">
      <div className="md:w-1/3">
        <label className="font-medium text-sm text-surface-900 dark:text-white">
          {label} Reference Image
        </label>
        <p className="text-surface-600 dark:text-surface-400 text-xs mt-0.5">{description}</p>
      </div>
      
      <div className="md:w-2/3 flex flex-col sm:flex-row gap-4">
        {/* Preview image */}
        <div className="flex-shrink-0">
          {previewUrl ? (
            <div className="relative">
              <img
                src={previewUrl}
                alt={`${label} Preview`}
                className="w-24 h-24 rounded-xl object-cover border-2 border-primary-300 dark:border-primary-700"
              />
              {photo && (
                <div className="absolute inset-0 rounded-xl bg-black/40 flex items-center justify-center">
                  <span className="text-white text-xs font-medium">Unsaved</span>
                </div>
              )}
            </div>
          ) : (
            <div className="w-24 h-24 rounded-xl bg-surface-200 dark:bg-surface-800 border-2 border-dashed border-surface-400 dark:border-surface-600 flex flex-col items-center justify-center">
              <span className="text-surface-500 dark:text-surface-400 text-xs">No image</span>
            </div>
          )}
        </div>

        {/* Input & Upload Button */}
        <div className="flex-1 space-y-3">
          <input
            type="file"
            accept="image/*"
            onChange={handlePhotoChange}
            className="input-field file:mr-4 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:bg-primary-100 dark:file:bg-primary-900/30 file:text-primary-700 dark:file:text-primary-400 file:font-medium file:text-xs file:cursor-pointer hover:file:bg-primary-200 dark:hover:file:bg-primary-900/50 w-full"
          />
          {photo && (
            <button
              onClick={handleSaveBtn}
              disabled={uploading}
              className="btn-primary text-sm py-1.5 px-3"
            >
              {uploading ? "Saving Reference..." : "Save Reference"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

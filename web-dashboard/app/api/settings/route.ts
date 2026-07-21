import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

async function ensureUniformReferencesBucket(): Promise<void> {
  const bucketName = "uniform-references";
  const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();

  if (listError) {
    throw new Error(`Failed to list storage buckets: ${listError.message}`);
  }

  const exists = (buckets || []).some((bucket) => bucket.name === bucketName);

  if (!exists) {
    const { error: createError } = await supabaseAdmin.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: 5242880,
    });
    if (createError) {
      throw new Error(`Failed to create '${bucketName}' bucket: ${createError.message}`);
    }
    return;
  }

  const { error: updateError } = await supabaseAdmin.storage.updateBucket(bucketName, {
    public: true,
  });

  if (updateError) {
    throw new Error(`Failed to update '${bucketName}' bucket: ${updateError.message}`);
  }
}

function sanitizeStorageFileName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * GET /api/settings
 * Retrieves system settings. Optionally filter by key.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (key) {
      const { data, error } = await supabaseAdmin
        .from("system_settings")
        .select("*")
        .eq("key", key)
        .single();

      if (error) {
        return NextResponse.json(
          { error: "Setting not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(data);
    }

    const { data, error } = await supabaseAdmin
      .from("system_settings")
      .select("*")
      .order("key", { ascending: true });

    if (error) {
      console.error("Error fetching settings:", error);
      return NextResponse.json(
        { error: "Failed to fetch settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({ settings: data || [] });
  } catch (error) {
    console.error("Settings GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings
 * Updates system settings. Accepts a single { key, value } JSON or an array.
 * Also handles multipart/form-data for uniform reference image uploads.
 */
export async function PUT(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // Handle file upload for a setting
      const formData = await request.formData();
      const key = formData.get("key") as string;
      const fileValue = formData.get("file");
      const customName = (formData.get("custom_name") as string | null) || "";
      const uniformRefList = (formData.get("uniform_ref_list") as string | null) || "";
      const nameKey = (formData.get("name_key") as string | null) || "";
      const nameValue = (formData.get("name_value") as string | null) || "";

      if (!key) {
        return NextResponse.json({ error: "Missing key" }, { status: 400 });
      }

      if (!(fileValue instanceof File)) {
        return NextResponse.json({ error: "Invalid or missing file upload" }, { status: 400 });
      }

      const file = fileValue;

      try {
        await ensureUniformReferencesBucket();
      } catch (bucketError) {
        console.warn("Bucket check warning (continuing upload attempt):", bucketError);
      }

      const fileExt = file.name.split(".").pop();
      const safeName = sanitizeStorageFileName(customName);
      const baseName = safeName || `${key}_${Date.now()}`;
      const fileName = `${baseName}.${fileExt || "jpg"}`;

      const fileBuffer = Buffer.from(await file.arrayBuffer());

      const { data: uploadData, error: uploadError } = await supabaseAdmin
        .storage
        .from("uniform-references")
        .upload(fileName, fileBuffer, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        return NextResponse.json({ error: uploadError.message || "File upload failed" }, { status: 500 });
      }

      const { data: urlData } = supabaseAdmin.storage
        .from("uniform-references")
        .getPublicUrl(uploadData.path);
        
      const publicUrl = urlData.publicUrl;

      // Update the settings table with the URL
      const { data, error } = await supabaseAdmin
        .from("system_settings")
        .upsert({ key, value: publicUrl, updated_at: new Date().toISOString() }, { onConflict: "key" })
        .select()
        .single();

      if (error) {
         return NextResponse.json({ error: "Failed to save URL to settings" }, { status: 500 });
      }

      // Optional: persist display name and list metadata in the same save operation.
      const metadataUpserts: Array<{ key: string; value: string; updated_at: string }> = [];
      const now = new Date().toISOString();

      if (uniformRefList) {
        metadataUpserts.push({ key: "uniform_ref_list", value: uniformRefList, updated_at: now });
      }
      if (nameKey && nameValue) {
        metadataUpserts.push({ key: nameKey, value: nameValue, updated_at: now });
      }

      if (metadataUpserts.length > 0) {
        const { error: metaError } = await supabaseAdmin
          .from("system_settings")
          .upsert(metadataUpserts, { onConflict: "key" });

        if (metaError) {
          console.error("Metadata upsert error:", metaError);
          return NextResponse.json(
            { error: `Saved image but failed to save reference metadata: ${metaError.message}` },
            { status: 500 }
          );
        }
      }

      return NextResponse.json({ setting: data });
    }

    // Standard JSON payload
    const body = await request.json();

    // Handle single setting update
    if (body.key && body.value !== undefined) {
      const { data, error } = await supabaseAdmin
        .from("system_settings")
        .upsert(
          { key: body.key, value: String(body.value), updated_at: new Date().toISOString() },
          { onConflict: "key" }
        )
        .select()
        .single();

      if (error) {
        console.error("Error updating setting:", error);
        return NextResponse.json(
          { error: error.message || "Failed to update setting" },
          { status: 500 }
        );
      }

      return NextResponse.json({ setting: data });
    }

    // Handle batch settings update
    if (body.settings && Array.isArray(body.settings)) {
      const results = [];
      for (const setting of body.settings) {
        if (setting.key && setting.value !== undefined) {
          const { data, error } = await supabaseAdmin
            .from("system_settings")
            .upsert(
              { key: setting.key, value: String(setting.value), updated_at: new Date().toISOString() },
              { onConflict: "key" }
            )
            .select()
            .single();

          if (error) {
            console.error(`Error updating setting ${setting.key}:`, error);
          } else {
            results.push(data);
          }
        }
      }
      return NextResponse.json({ settings: results });
    }

    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Settings PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/settings
 * Deletes one or more settings keys.
 * Accepts JSON: { key: string } or { keys: string[] }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const keys: string[] = [];

    if (typeof body?.key === "string" && body.key.trim()) {
      keys.push(body.key.trim());
    }

    if (Array.isArray(body?.keys)) {
      body.keys.forEach((k: unknown) => {
        if (typeof k === "string" && k.trim()) {
          keys.push(k.trim());
        }
      });
    }

    const uniqueKeys = Array.from(new Set(keys));
    if (uniqueKeys.length === 0) {
      return NextResponse.json({ error: "No setting keys provided" }, { status: 400 });
    }

    // Fetch values first so we can remove storage objects referenced by image URL keys.
    const { data: existingRows, error: selectError } = await supabaseAdmin
      .from("system_settings")
      .select("key, value")
      .in("key", uniqueKeys);

    if (selectError) {
      console.error("Settings DELETE select error:", selectError);
      return NextResponse.json({ error: selectError.message || "Failed to read settings before delete" }, { status: 500 });
    }

    const marker = "/storage/v1/object/public/uniform-references/";
    const objectPaths: string[] = [];
    (existingRows || []).forEach((row) => {
      const key = String(row.key || "");
      const value = String(row.value || "");
      const isImageKey = key.startsWith("uniform_ref_") && !key.startsWith("uniform_ref_name_") && key !== "uniform_ref_list";
      if (!isImageKey || !value.includes(marker)) {
        return;
      }
      const idx = value.indexOf(marker);
      if (idx >= 0) {
        const encodedPath = value.slice(idx + marker.length);
        const cleanPath = decodeURIComponent(encodedPath.split("?")[0] || "");
        if (cleanPath) {
          objectPaths.push(cleanPath);
        }
      }
    });

    if (objectPaths.length > 0) {
      const { error: storageDeleteError } = await supabaseAdmin
        .storage
        .from("uniform-references")
        .remove(Array.from(new Set(objectPaths)));

      if (storageDeleteError) {
        console.error("Settings DELETE storage error:", storageDeleteError);
        return NextResponse.json({ error: storageDeleteError.message || "Failed to delete storage objects" }, { status: 500 });
      }
    }

    const { error } = await supabaseAdmin
      .from("system_settings")
      .delete()
      .in("key", uniqueKeys);

    if (error) {
      console.error("Settings DELETE error:", error);
      return NextResponse.json({ error: error.message || "Failed to delete settings" }, { status: 500 });
    }

    return NextResponse.json({ deleted: uniqueKeys.length, keys: uniqueKeys });
  } catch (error) {
    console.error("Settings DELETE handler error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

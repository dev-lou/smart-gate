import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * GET /api/faculty
 * Retrieves all faculty profiles.
 */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("students")
      .select(
        "id, name, student_id, person_type, fingerprint_id, uniform_type, photo_url, department, grade, section, is_active, created_at, updated_at",
      )
      .eq("person_type", "faculty")
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching faculty:", error);
      return NextResponse.json(
        { error: "Failed to fetch faculty" },
        { status: 500 },
      );
    }

    return NextResponse.json({ students: data || [] });
  } catch (error) {
    console.error("Faculty GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/faculty
 * Creates a new faculty profile.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const name = formData.get("name") as string;
    const fingerprintId = formData.get("fingerprint_id") as string;
    const department = formData.get("department") as string;
    const photo = formData.get("photo") as File | null;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let photoUrl: string | null = null;

    if (photo && photo.size > 0) {
      const fileExt = photo.name.split(".").pop();
      const fileName = `${Date.now()}_${name.replace(/\s+/g, "_") || "faculty"}.${fileExt}`;

      const { data: uploadData, error: uploadError } =
        await supabaseAdmin.storage
          .from("student-photos")
          .upload(fileName, photo, {
            contentType: photo.type,
            upsert: true,
          });

      if (uploadError) {
        console.error("Photo upload error:", uploadError);
        return NextResponse.json(
          {
            error:
              "Photo upload failed. Please try again or check storage bucket.",
          },
          { status: 400 },
        );
      } else if (uploadData) {
        const { data: urlData } = supabaseAdmin.storage
          .from("student-photos")
          .getPublicUrl(uploadData.path);
        photoUrl = urlData.publicUrl;
      }
    }

    const { data, error } = await supabaseAdmin
      .from("students")
      .insert({
        name,
        person_type: "faculty",
        fingerprint_id: fingerprintId || null,
        uniform_type: "default",
        photo_url: photoUrl,
        department: department || null,
        grade: null,
        section: null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating faculty:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create faculty" },
        { status: 500 },
      );
    }

    return NextResponse.json({ student: data }, { status: 201 });
  } catch (error) {
    console.error("Faculty POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/faculty
 * Updates an existing faculty profile.
 */
export async function PUT(request: NextRequest) {
  try {
    const formData = await request.formData();
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const fingerprintId = formData.get("fingerprint_id") as string;
    const department = formData.get("department") as string;
    const isActive = formData.get("is_active");
    const photo = formData.get("photo") as File | null;

    if (!id) {
      return NextResponse.json(
        { error: "Faculty ID is required" },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (name) updateData.name = name;
    updateData.person_type = "faculty";
    if (fingerprintId !== null)
      updateData.fingerprint_id = fingerprintId || null;
    if (department !== null) updateData.department = department || null;
    updateData.grade = null;
    updateData.section = null;
    if (isActive !== null) updateData.is_active = isActive === "true";

    if (photo && photo.size > 0) {
      const fileExt = photo.name.split(".").pop();
      const fileName = `${Date.now()}_${name?.replace(/\s+/g, "_") || id}.${fileExt}`;

      const { data: uploadData, error: uploadError } =
        await supabaseAdmin.storage
          .from("student-photos")
          .upload(fileName, photo, {
            contentType: photo.type,
            upsert: true,
          });

      if (uploadError) {
        console.error("Photo upload error:", uploadError);
        return NextResponse.json(
          {
            error:
              "Photo upload failed. Please try again or check storage bucket.",
          },
          { status: 400 },
        );
      } else if (uploadData) {
        const { data: urlData } = supabaseAdmin.storage
          .from("student-photos")
          .getPublicUrl(uploadData.path);
        updateData.photo_url = urlData.publicUrl;
      }
    }

    const { data, error } = await supabaseAdmin
      .from("students")
      .update(updateData)
      .eq("id", id)
      .eq("person_type", "faculty")
      .select()
      .single();

    if (error) {
      console.error("Error updating faculty:", error);
      return NextResponse.json(
        { error: error.message || "Failed to update faculty" },
        { status: 500 },
      );
    }

    return NextResponse.json({ student: data });
  } catch (error) {
    console.error("Faculty PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/faculty
 * Soft-deletes a faculty profile (sets is_active = false).
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Faculty ID is required" },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin
      .from("students")
      .update({ is_active: false })
      .eq("id", id)
      .eq("person_type", "faculty");

    if (error) {
      console.error("Error deleting faculty:", error);
      return NextResponse.json(
        { error: "Failed to delete faculty" },
        { status: 500 },
      );
    }

    return NextResponse.json({ message: "Faculty deactivated" });
  } catch (error) {
    console.error("Faculty DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

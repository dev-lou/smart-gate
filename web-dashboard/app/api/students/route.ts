import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * GET /api/students
 * Retrieves all students.
 */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("students")
      .select(
        "id, name, student_id, person_type, fingerprint_id, uniform_type, photo_url, department, grade, section, is_active, created_at, updated_at",
      )
      .eq("person_type", "student")
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching students:", error);
      return NextResponse.json(
        { error: "Failed to fetch students" },
        { status: 500 },
      );
    }

    return NextResponse.json({ students: data || [] });
  } catch (error) {
    console.error("Students GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/students
 * Creates a new student record.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const name = formData.get("name") as string;
    const fingerprintId = formData.get("fingerprint_id") as string;
    const department = formData.get("department") as string;
    const grade = formData.get("grade") as string;
    const section = formData.get("section") as string;
    const uniformType = formData.get("uniform_type") as string;
    const photo = formData.get("photo") as File | null;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let photoUrl: string | null = null;

    // Upload photo to Supabase Storage if provided
    if (photo && photo.size > 0) {
      const fileExt = photo.name.split(".").pop();
      const fileName = `${Date.now()}_${name.replace(/\s+/g, "_") || "person"}.${fileExt}`;

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
            error: `Photo upload failed. Please try again or check storage bucket.`,
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

    // Insert student record
    const { data, error } = await supabaseAdmin
      .from("students")
      .insert({
        name,
        person_type: "student",
        fingerprint_id: fingerprintId || null,
        uniform_type: uniformType || "default",
        photo_url: photoUrl,
        department: department || null,
        grade: grade || null,
        section: section || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating student:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create student" },
        { status: 500 },
      );
    }

    return NextResponse.json({ student: data }, { status: 201 });
  } catch (error) {
    console.error("Students POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/students
 * Updates an existing student record.
 */
export async function PUT(request: NextRequest) {
  try {
    const formData = await request.formData();
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const fingerprintId = formData.get("fingerprint_id") as string;
    const department = formData.get("department") as string;
    const grade = formData.get("grade") as string;
    const section = formData.get("section") as string;
    const uniformType = formData.get("uniform_type") as string;
    const isActive = formData.get("is_active");
    const photo = formData.get("photo") as File | null;

    if (!id) {
      return NextResponse.json(
        { error: "Student ID is required" },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (name) updateData.name = name;
    updateData.person_type = "student";
    if (fingerprintId !== null)
      updateData.fingerprint_id = fingerprintId || null;
    if (department !== null) updateData.department = department || null;
    if (uniformType !== null)
      updateData.uniform_type = uniformType || "default";
    if (grade !== null) updateData.grade = grade || null;
    if (section !== null) updateData.section = section || null;
    if (isActive !== null) updateData.is_active = isActive === "true";

    // Upload new photo if provided
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
            error: `Photo upload failed. Please try again or check storage bucket.`,
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
      .eq("person_type", "student")
      .select()
      .single();

    if (error) {
      console.error("Error updating student:", error);
      return NextResponse.json(
        { error: error.message || "Failed to update student" },
        { status: 500 },
      );
    }

    return NextResponse.json({ student: data });
  } catch (error) {
    console.error("Students PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/students
 * Soft-deletes a student (sets is_active = false).
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Student ID is required" },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin
      .from("students")
      .update({ is_active: false })
      .eq("id", id)
      .eq("person_type", "student");

    if (error) {
      console.error("Error deleting student:", error);
      return NextResponse.json(
        { error: "Failed to delete student" },
        { status: 500 },
      );
    }

    return NextResponse.json({ message: "Student deactivated" });
  } catch (error) {
    console.error("Students DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

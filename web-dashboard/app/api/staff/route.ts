import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function uploadPhoto(photo: File, name: string) {
  const fileExt = photo.name.split(".").pop();
  const fileName = `${Date.now()}_${name.replace(/\s+/g, "_") || "staff"}.${fileExt}`;

  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from("student-photos")
    .upload(fileName, photo, {
      contentType: photo.type,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(uploadError.message || "Photo upload failed");
  }

  const { data: urlData } = supabaseAdmin.storage
    .from("student-photos")
    .getPublicUrl(uploadData.path);

  return urlData.publicUrl;
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("students")
      .select("id, name, student_id, person_type, fingerprint_id, uniform_type, photo_url, department, grade, section, is_active, created_at, updated_at")
      .eq("person_type", "staff")
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching staff:", error);
      return NextResponse.json(
        { error: "Failed to fetch staff" },
        { status: 500 },
      );
    }

    return NextResponse.json({ students: data || [] });
  } catch (error) {
    console.error("Staff GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

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
      try {
        photoUrl = await uploadPhoto(photo, name);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Photo upload failed" },
          { status: 400 },
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from("students")
      .insert({
        name,
        person_type: "staff",
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
      console.error("Error creating staff:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create staff" },
        { status: 500 },
      );
    }

    return NextResponse.json({ student: data }, { status: 201 });
  } catch (error) {
    console.error("Staff POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

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
        { error: "Staff ID is required" },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = { person_type: "staff" };
    if (name) updateData.name = name;
    if (fingerprintId !== null) updateData.fingerprint_id = fingerprintId || null;
    if (department !== null) updateData.department = department || null;
    updateData.grade = null;
    updateData.section = null;
    if (isActive !== null) updateData.is_active = isActive === "true";

    if (photo && photo.size > 0) {
      try {
        updateData.photo_url = await uploadPhoto(photo, name || id);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Photo upload failed" },
          { status: 400 },
        );
      }
    }

    const { data, error } = await supabaseAdmin
      .from("students")
      .update(updateData)
      .eq("id", id)
      .eq("person_type", "staff")
      .select()
      .single();

    if (error) {
      console.error("Error updating staff:", error);
      return NextResponse.json(
        { error: error.message || "Failed to update staff" },
        { status: 500 },
      );
    }

    return NextResponse.json({ student: data });
  } catch (error) {
    console.error("Staff PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Staff ID is required" },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin
      .from("students")
      .update({ is_active: false })
      .eq("id", id)
      .eq("person_type", "staff");

    if (error) {
      console.error("Error deleting staff:", error);
      return NextResponse.json(
        { error: "Failed to delete staff" },
        { status: 500 },
      );
    }

    return NextResponse.json({ message: "Staff deactivated" });
  } catch (error) {
    console.error("Staff DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

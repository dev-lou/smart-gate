import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("base64url");
}

async function writeAudit(
  action: string,
  entityId: string | null,
  details: Record<string, unknown>,
) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    actor_name: details.actor_name || "Guard/Admin",
    action,
    entity_type: "guest_visit",
    entity_id: entityId,
    details,
  });
  if (error) console.warn("Guest visit audit log failed:", error.message);
}

/**
 * GET /api/guest-visits
 * Lists QR-based guest visit records.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const activeOnly = searchParams.get("active_only");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    let query = supabaseAdmin
      .from("guest_visits")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (activeOnly === "true") query = query.eq("is_active", true);

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching guest visits:", error);
      return NextResponse.json(
        { error: error.message || "Failed to fetch guest visits" },
        { status: 500 },
      );
    }

    return NextResponse.json({ guest_visits: data || [] });
  } catch (error) {
    console.error("Guest visits GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/guest-visits
 * Creates a temporary guest visit and returns the raw QR token once.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const qrToken = makeToken();
    const now = new Date().toISOString();
    const autoCheckIn = Boolean(body.auto_check_in);

    const insertData = {
      visitor_name: body.visitor_name || null,
      purpose: body.purpose || null,
      host_person_id: body.host_person_id || null,
      host_name: body.host_name || null,
      department: body.department || null,
      contact_number: body.contact_number || null,
      photo_url: body.photo_url || null,
      qr_token_hash: hashToken(qrToken),
      status: autoCheckIn
        ? body.visitor_name
          ? "inside_details_complete"
          : "inside_pending_details"
        : body.status || "pending_approval",
      checked_in_at: autoCheckIn ? now : null,
      entry_gate_id: body.entry_gate_id || "GATE-01",
      guard_in_id: autoCheckIn ? body.guard_in_id || null : null,
      guard_in_name: autoCheckIn ? body.guard_in_name || null : null,
      remarks: body.remarks || null,
      valid_until: body.valid_until || null,
      is_active: true,
    };

    const { data, error } = await supabaseAdmin
      .from("guest_visits")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("Error creating guest visit:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create guest visit" },
        { status: 500 },
      );
    }

    await writeAudit("guest_visit_created", data.id, {
      actor_name: body.guard_in_name || "Guard/Admin",
      auto_check_in: autoCheckIn,
      status: data.status,
    });

    return NextResponse.json(
      {
        guest_visit: data,
        qr_token: qrToken,
        qr_payload: qrToken,
        message:
          "Guest visit created. Save or display this QR token for guest exit.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Guest visits POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/guest-visits
 * Updates details or performs approve/check-out/status actions.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Guest visit ID is required" },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {};

    const editableFields = [
      "visitor_name",
      "purpose",
      "host_person_id",
      "host_name",
      "department",
      "contact_number",
      "photo_url",
      "remarks",
      "valid_until",
      "entry_gate_id",
      "exit_gate_id",
      "guard_in_id",
      "guard_in_name",
      "guard_out_id",
      "guard_out_name",
    ];

    for (const field of editableFields) {
      if (body[field] !== undefined) updateData[field] = body[field] || null;
    }

    if (action === "approve_entry") {
      updateData.status =
        body.visitor_name || body.has_details
          ? "inside_details_complete"
          : "inside_pending_details";
      updateData.checked_in_at = body.checked_in_at || now;
      updateData.guard_in_id = body.guard_in_id || null;
      updateData.guard_in_name = body.guard_in_name || null;
      updateData.entry_gate_id = body.entry_gate_id || "GATE-01";
    } else if (action === "checkout") {
      updateData.status = "completed";
      updateData.checked_out_at = body.checked_out_at || now;
      updateData.guard_out_id = body.guard_out_id || null;
      updateData.guard_out_name = body.guard_out_name || null;
      updateData.exit_gate_id = body.exit_gate_id || "GATE-01";
    } else if (action === "manual_checkout") {
      updateData.status = "manual_checkout";
      updateData.checked_out_at = body.checked_out_at || now;
      updateData.guard_out_id = body.guard_out_id || null;
      updateData.guard_out_name = body.guard_out_name || null;
      updateData.exit_gate_id = body.exit_gate_id || "GATE-01";
    } else if (action === "cancel") {
      updateData.status = "cancelled";
      updateData.is_active = false;
    } else if (body.status) {
      updateData.status = body.status;
    }

    const { data, error } = await supabaseAdmin
      .from("guest_visits")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Error updating guest visit:", error);
      return NextResponse.json(
        { error: error.message || "Failed to update guest visit" },
        { status: 500 },
      );
    }

    await writeAudit(action || "guest_visit_updated", data.id, {
      actor_name: body.guard_in_name || body.guard_out_name || "Guard/Admin",
      status: data.status,
    });

    return NextResponse.json({ guest_visit: data });
  } catch (error) {
    console.error("Guest visits PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/guest-visits?id=...
 * Soft-cancels a guest visit.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Guest visit ID is required" },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin
      .from("guest_visits")
      .update({ is_active: false, status: "cancelled" })
      .eq("id", id);

    if (error) {
      console.error("Error cancelling guest visit:", error);
      return NextResponse.json(
        { error: error.message || "Failed to cancel guest visit" },
        { status: 500 },
      );
    }

    await writeAudit("guest_visit_cancelled", id, {
      actor_name: "Guard/Admin",
    });

    return NextResponse.json({ message: "Guest visit cancelled" });
  } catch (error) {
    console.error("Guest visits DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

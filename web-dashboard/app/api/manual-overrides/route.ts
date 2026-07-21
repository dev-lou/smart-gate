import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * POST /api/manual-overrides
 * Records a guard/manual gate opening in access_logs.
 * Physical gate opening should be handled by the local Brain API when available.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const direction = body.direction === "exit" ? "exit" : "entry";
    const reason = body.reason || "Manual override";

    const insertData = {
      person_id: body.person_id || null,
      person_name: body.person_name || body.operator_name || "Manual Override",
      person_type: body.person_type || "manual",
      guest_visit_id: body.guest_visit_id || null,
      direction,
      method: "manual",
      success: true,
      confidence: 1,
      uniform_ok: null,
      photo_url: body.photo_url || null,
      gate_id: body.gate_id || "GATE-01",
      failure_reason: reason,
      override_operator_id: body.operator_id || null,
      override_operator_name: body.operator_name || null,
      override_reason: reason,
      override_source: body.source || "dashboard",
      device_timestamp: body.device_timestamp || new Date().toISOString(),
      synced_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("access_logs")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("Error recording manual override:", error);
      return NextResponse.json(
        { error: error.message || "Failed to record manual override" },
        { status: 500 },
      );
    }

    const { error: auditError } = await supabaseAdmin
      .from("audit_logs")
      .insert({
        actor_id: body.operator_id || null,
        actor_name: body.operator_name || "Guard/Admin",
        action: "manual_override_recorded",
        entity_type: "access_log",
        entity_id: data.id,
        details: {
          direction,
          gate_id: insertData.gate_id,
          reason,
          source: insertData.override_source,
        },
      });
    if (auditError)
      console.warn("Manual override audit log failed:", auditError.message);

    return NextResponse.json({ log: data }, { status: 201 });
  } catch (error) {
    console.error("Manual override POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

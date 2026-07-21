import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const entityType = searchParams.get("entity_type");

    let query = supabaseAdmin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (entityType) query = query.eq("entity_type", entityType);

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching audit logs:", error);
      return NextResponse.json(
        { error: error.message || "Failed to fetch audit logs" },
        { status: 500 },
      );
    }

    return NextResponse.json({ audit_logs: data || [] });
  } catch (error) {
    console.error("Audit logs GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.action || !body.entity_type) {
      return NextResponse.json(
        { error: "action and entity_type are required" },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .insert({
        actor_id: body.actor_id || null,
        actor_name: body.actor_name || null,
        action: body.action,
        entity_type: body.entity_type,
        entity_id: body.entity_id || null,
        details: body.details || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating audit log:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create audit log" },
        { status: 500 },
      );
    }

    return NextResponse.json({ audit_log: data }, { status: 201 });
  } catch (error) {
    console.error("Audit logs POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

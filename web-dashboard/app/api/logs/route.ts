import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { LogPushPayload } from "@/types";

/**
 * POST /api/logs
 * Receives access logs from the Raspberry Pi and inserts them into Supabase.
 */
export async function POST(request: NextRequest) {
  try {
    const body: LogPushPayload = await request.json();
    const logs = body.logs;

    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      return NextResponse.json({ error: "No logs provided" }, { status: 400 });
    }

    // Insert logs into Supabase
    const insertData = logs.map((log) => ({
      person_id: log.person_id,
      person_name: log.person_name,
      person_type: log.person_type || null,
      guest_visit_id: log.guest_visit_id || null,
      direction: log.direction || "entry",
      method: log.method,
      success: log.success,
      confidence: log.confidence,
      uniform_ok: log.uniform_ok,
      photo_url: log.photo_url,
      gate_id: log.gate_id || "GATE-01",
      failure_reason: log.failure_reason,
      override_operator_id: log.override_operator_id || null,
      override_operator_name: log.override_operator_name || null,
      override_reason: log.override_reason || null,
      override_source: log.override_source || null,
      device_timestamp: log.device_timestamp,
      synced_at: new Date().toISOString(),
    }));

    const { data, error } = await supabaseAdmin
      .from("access_logs")
      .insert(insertData)
      .select();

    if (error) {
      console.error("Error inserting logs:", error);
      return NextResponse.json(
        { error: "Failed to insert logs" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: `Successfully inserted ${data.length} logs`,
      count: data.length,
    });
  } catch (error) {
    console.error("Logs API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/logs
 * Retrieves access logs with optional filters.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const success = searchParams.get("success");
    const method = searchParams.get("method");
    const direction = searchParams.get("direction");
    const personType = searchParams.get("person_type");
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");
    const personId =
      searchParams.get("person_id") || searchParams.get("student_id");

    let query = supabaseAdmin
      .from("access_logs")
      .select("*", { count: "exact" })
      .order("device_timestamp", { ascending: false })
      .range(offset, offset + limit - 1);

    if (success !== null && success !== "") {
      query = query.eq("success", success === "true");
    }
    if (method) {
      query = query.eq("method", method);
    }
    if (direction) {
      query = query.eq("direction", direction);
    }
    if (personType) {
      query = query.eq("person_type", personType);
    }
    if (dateFrom) {
      query = query.gte("device_timestamp", dateFrom);
    }
    if (dateTo) {
      query = query.lte("device_timestamp", dateTo);
    }
    if (personId) {
      query = query.eq("person_id", personId);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("Error fetching logs:", error);
      return NextResponse.json(
        { error: "Failed to fetch logs" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      logs: data || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Logs GET API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

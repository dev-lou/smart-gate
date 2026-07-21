import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/sync?last_sync=ISO8601
 * Returns enrolled people, guest cards, guest visits, and settings updated since the given timestamp.
 * Called by the Raspberry Pi controller during periodic sync.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lastSync = searchParams.get("last_sync") || "1970-01-01T00:00:00";
    const syncTime = new Date().toISOString();

    // Fetch students updated since last sync
    const { data: students, error: studentsError } = await supabaseAdmin
      .from("students")
      .select("*")
      .gte("updated_at", lastSync)
      .order("updated_at", { ascending: true });

    if (studentsError) {
      console.error("Error fetching students:", studentsError);
      return NextResponse.json(
        { error: "Failed to fetch students" },
        { status: 500 },
      );
    }

    // Convert face_embedding to base64 for transport
    const processedStudents = (students || []).map((s) => ({
      ...s,
      face_embedding: s.face_embedding
        ? Buffer.from(s.face_embedding).toString("base64")
        : null,
    }));

    // Fetch guest cards updated since last sync
    const { data: guestCards, error: cardsError } = await supabaseAdmin
      .from("guest_cards")
      .select("*")
      .gte("updated_at", lastSync)
      .order("updated_at", { ascending: true });

    if (cardsError) {
      console.error("Error fetching guest cards:", cardsError);
      return NextResponse.json(
        { error: "Failed to fetch guest cards" },
        { status: 500 },
      );
    }

    // Fetch QR guest visits updated since last sync
    const { data: guestVisits, error: guestVisitsError } = await supabaseAdmin
      .from("guest_visits")
      .select("*")
      .gte("updated_at", lastSync)
      .order("updated_at", { ascending: true });

    if (guestVisitsError) {
      console.error("Error fetching guest visits:", guestVisitsError);
      return NextResponse.json(
        { error: "Failed to fetch guest visits" },
        { status: 500 },
      );
    }

    // Fetch system settings
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("system_settings")
      .select("*")
      .gte("updated_at", lastSync);

    if (settingsError) {
      console.error("Error fetching settings:", settingsError);
    }

    return NextResponse.json({
      students: processedStudents,
      guest_cards: guestCards || [],
      guest_visits: guestVisits || [],
      settings: settings || [],
      sync_time: syncTime,
    });
  } catch (error) {
    console.error("Sync API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * GET /api/cards
 * Retrieves all guest cards.
 */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("guest_cards")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching cards:", error);
      return NextResponse.json(
        { error: "Failed to fetch cards" },
        { status: 500 }
      );
    }

    return NextResponse.json({ cards: data || [] });
  } catch (error) {
    console.error("Cards GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cards
 * Creates a new guest card.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { card_uid, holder_name, purpose, valid_until } = body;

    if (!card_uid || !holder_name) {
      return NextResponse.json(
        { error: "Card UID and holder name are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("guest_cards")
      .insert({
        card_uid,
        holder_name,
        purpose: purpose || null,
        valid_until: valid_until || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating card:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create card" },
        { status: 500 }
      );
    }

    return NextResponse.json({ card: data }, { status: 201 });
  } catch (error) {
    console.error("Cards POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/cards
 * Updates an existing guest card.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, card_uid, holder_name, purpose, valid_until, is_active } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Card ID is required" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (card_uid !== undefined) updateData.card_uid = card_uid;
    if (holder_name !== undefined) updateData.holder_name = holder_name;
    if (purpose !== undefined) updateData.purpose = purpose;
    if (valid_until !== undefined) updateData.valid_until = valid_until || null;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabaseAdmin
      .from("guest_cards")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Error updating card:", error);
      return NextResponse.json(
        { error: error.message || "Failed to update card" },
        { status: 500 }
      );
    }

    return NextResponse.json({ card: data });
  } catch (error) {
    console.error("Cards PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cards
 * Deactivates a guest card.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Card ID is required" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("guest_cards")
      .update({ is_active: false })
      .eq("id", id);

    if (error) {
      console.error("Error deleting card:", error);
      return NextResponse.json(
        { error: "Failed to delete card" },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Card deactivated" });
  } catch (error) {
    console.error("Cards DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

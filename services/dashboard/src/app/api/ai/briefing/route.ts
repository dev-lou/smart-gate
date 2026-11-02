import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateText, isAiConfigured } from "@/lib/gemini";
import { getGateSnapshot } from "@/lib/aiContext";

function serverSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// GET: today's cached briefing (zero AI calls per page view).
export async function GET() {
  try {
    const supabase = serverSupabase();
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("daily_briefings")
      .select("content, created_at")
      .eq("briefing_date", today)
      .maybeSingle();
    return NextResponse.json({ briefing: data?.content ?? null, generatedAt: data?.created_at ?? null });
  } catch {
    return NextResponse.json({ briefing: null, generatedAt: null });
  }
}

// POST: generate (or regenerate) today's briefing — exactly 1 AI call.
export async function POST() {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI is not set up yet — add GEMINI_API_KEY to the dashboard .env.local and restart." },
      { status: 503 },
    );
  }

  try {
    const snap = await getGateSnapshot();
    const prompt = `Write a short morning briefing for a school dean about today's gate activity. 4-6 plain-text lines, no markdown headings, no bullet symbols. Cover: headline counts, any denials or unknown faces worth knowing, guest passes used, and the busiest time if visible. If there are no events yet, say the gate is quiet so far.

Today (${snap.date}): ${snap.total} events, ${snap.granted} granted, ${snap.denied} denied, ${snap.studentsIn} students entered, ${snap.guestsIn} guests entered.
Recent events (newest first):
${snap.lines.join("\n") || "(no events today yet)"}`;

    const content = await generateText(prompt);
    const supabase = serverSupabase();
    await supabase.from("daily_briefings").upsert(
      {
        briefing_date: snap.date,
        content,
        stats: {
          total: snap.total,
          granted: snap.granted,
          denied: snap.denied,
          studentsIn: snap.studentsIn,
          guestsIn: snap.guestsIn,
        },
      },
      { onConflict: "briefing_date" },
    );

    return NextResponse.json({ briefing: content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI_ERROR";
    if (msg === "AI_BUSY") {
      return NextResponse.json(
        { error: "The AI is busy — try again in a minute." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "Could not generate the briefing just now." }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { generateText, isAiConfigured } from "@/lib/gemini";
import { getGateSnapshot } from "@/lib/aiContext";

export async function POST(req: Request) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI is not set up yet — add GEMINI_API_KEY to the dashboard .env.local and restart." },
      { status: 503 },
    );
  }

  let question = "";
  try {
    const body = await req.json();
    question = String(body?.question ?? "").slice(0, 500).trim();
  } catch {
    /* fall through to validation */
  }
  if (!question) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }

  try {
    const snap = await getGateSnapshot();
    const prompt = `You are the Smart Gate school assistant. Answer the dean's question using ONLY the gate data below. If the data does not cover the question, say so in one sentence and offer the closest related fact. Keep the answer under 80 words, plain text, no markdown tables.

Today (${snap.date}): ${snap.total} gate events, ${snap.granted} granted, ${snap.denied} denied, ${snap.studentsIn} students entered, ${snap.guestsIn} guests entered, ${snap.enrolledStudents} students enrolled.
Recent events (newest first):
${snap.lines.join("\n") || "(no events today yet)"}

Question: ${question}`;

    const answer = await generateText(prompt);
    return NextResponse.json({ answer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI_ERROR";
    if (msg === "AI_BUSY") {
      return NextResponse.json(
        { error: "The AI is busy — try again in a minute. Gate scanning is unaffected." },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "Could not reach the AI just now. The gate log below is still live." },
      { status: 502 },
    );
  }
}

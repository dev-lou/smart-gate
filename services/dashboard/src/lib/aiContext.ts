// Server-only: builds the compact gate-data snapshot that grounds every
// AI answer. The LLM never writes SQL — it only narrates rows we fetch.

import { createClient } from "@supabase/supabase-js";

export interface GateSnapshot {
  date: string;
  total: number;
  granted: number;
  denied: number;
  studentsIn: number;
  guestsIn: number;
  enrolledStudents: number;
  lines: string[];
}

function serverSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_NOT_CONFIGURED");
  return createClient(url, key);
}

function clock(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export async function getGateSnapshot(): Promise<GateSnapshot> {
  const supabase = serverSupabase();
  const date = new Date().toISOString().split("T")[0];

  const [{ count: studentsCount }, { data: logs }] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }),
    supabase
      .from("access_logs")
      .select("person_name, person_type, success, method, decision_note, failure_reason, device_timestamp")
      .gte("device_timestamp", new Date(date).toISOString())
      .order("device_timestamp", { ascending: false })
      .limit(120),
  ]);

  const rows = logs ?? [];
  const granted = rows.filter((l) => l.success);
  const lines = rows.slice(0, 80).map((l) => {
    const when = clock(l.device_timestamp);
    const who = l.person_name || "Unknown person";
    const what = l.success ? "GRANTED" : "DENIED";
    const note = l.decision_note || l.failure_reason || "";
    return `${when} ${what} ${who} (${l.method || "face"}${l.person_type ? `, ${l.person_type}` : ""})${note ? ` — ${note}` : ""}`;
  });

  return {
    date,
    total: rows.length,
    granted: granted.length,
    denied: rows.length - granted.length,
    studentsIn: new Set(
      granted.filter((l) => l.person_type !== "guest").map((l) => l.person_name || "?"),
    ).size,
    guestsIn: new Set(
      granted.filter((l) => l.person_type === "guest").map((l) => l.person_name || "?"),
    ).size,
    enrolledStudents: studentsCount ?? 0,
    lines,
  };
}

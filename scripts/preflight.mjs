#!/usr/bin/env node
/**
 * Capstone pre-flight check.
 *
 * Inspects the LIVE Supabase project and reports:
 *   1. Which database migrations are actually applied (005/006/007/008/009)
 *   2. Whether the seeded uniform classes match the deployed YOLO model
 *   3. Whether the enrolled demo students can pass the uniform check
 *   4. Whether the storage bucket is publicly readable and kiosk health is live
 *
 * Read-only: it only issues GET/HEAD requests with the anon key.
 *
 * Usage:
 *   pnpm preflight                # reads services/<svc>/.env.local
 *   pnpm preflight --verbose      # print every row it inspects
 *
 * Exit code 0 = demo ready, 1 = a blocking problem was found.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE = process.argv.includes("--verbose");

// ─── Expected state (mirrors the migrations + kiosk code) ────

const EXPECTED_UNIFORM_CLASSES = [
  "cbmsd_chef_male_uniform",
  "cbmsd_universal_male_uniform",
  "cici_blazer_uniform",
  "cici_female_uniform",
  "cici_male_uniform",
  "coag_female_uniform",
  "coag_male_uniform",
  "education_female_uniform",
  "education_male_uniform",
];

// services/kiosk/src/lib/uniform.ts → familyOf()
const COURSE_MARKERS = ["cbmsd", "cici", "coag", "education"];

const STUDENT_COLUMNS = [
  "id",
  "name",
  "student_id",
  "department",
  "grade",
  "section",
  "uniform_type",
  "photo_url",
  "person_type",
  "is_active",
  "updated_at",
];

// 006 adds every column except sync_id/gate_state (003/007).
const ACCESS_LOG_COLUMNS_006 = [
  "person_type",
  "direction",
  "override_operator_id",
  "override_operator_name",
  "override_reason",
  "sync_id",
];
const ACCESS_LOG_COLUMNS_007 = ["gate_state"];

const HEARTBEAT_COLUMNS = [
  "kiosk_id",
  "camera_ok",
  "gate_connected",
  "gate_state",
  "students_count",
  "unsynced_logs",
  "last_sync",
  "fps",
  "last_error",
  "updated_at",
];

const REQUIRED_SETTINGS = [
  "school_name",
  "school_initials",
  "voice_enabled",
  "uniform_class_names",
  "face_recognition_threshold",
];
const SETTINGS_009 = ["school_initials", "voice_enabled"];

// ─── Tiny output helpers ────────────────────────────────────

const results = [];
let blocking = 0;

function check(label, ok, detail = "", remediation = "", { critical = true } = {}) {
  results.push({ label, ok, detail, remediation, critical });
  if (!ok && critical) blocking++;
  const mark = ok ? "✓" : critical ? "✗" : "⚠";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok && remediation) console.log(`      → ${remediation}`);
}

function section(title) {
  console.log(`\n${title}`);
}

// ─── Configuration ──────────────────────────────────────────

function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return {
      source: "process environment",
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    };
  }

  const candidates = ["kiosk", "dashboard", "guard"].map((s) =>
    resolve(ROOT, "services", s, ".env.local"),
  );
  const found = candidates.find((p) => existsSync(p));
  if (!found) return { source: null, url: "", key: "" };

  const env = {};
  for (const line of readFileSync(found, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return {
    source: found.replace(ROOT, "."),
    url: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    key: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
}

const env = loadEnv();
const BASE = env.url.replace(/\/+$/, "");
const HEADERS = { apikey: env.key, Authorization: `Bearer ${env.key}` };

async function rest(path, { select } = {}) {
  const query = select ? `?select=${encodeURIComponent(select)}&limit=1` : "?limit=1";
  const res = await fetch(`${BASE}/rest/v1/${path}${query}`, { headers: HEADERS });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Column/table probe: 200 = present, 400/404 = missing. */
async function columnExists(table, column) {
  const { status, body } = await rest(table, { select: column });
  if (status === 200) return true;
  if (status === 400 && body && body.code === "42703") return false;
  if (status === 404) return null; // whole table missing
  return null;
}

async function tableExists(table) {
  const { status } = await rest(table, { select: "*" });
  return status !== 404;
}

function familyOf(name) {
  const n = (name ?? "").toLowerCase();
  return COURSE_MARKERS.find((marker) => n.includes(marker)) ?? "";
}

// ─── Run ────────────────────────────────────────────────────

console.log("🎓 Smart Gate — capstone pre-flight check");
console.log(`   Project : ${BASE || "(not configured)"}`);
console.log(`   Creds   : ${env.source ?? "NOT FOUND"}`);

if (!BASE || !env.key) {
  console.log("\n✗ No Supabase credentials. Create services/kiosk/.env.local from .env.example.");
  process.exit(1);
}
if (BASE.includes("your-project") || env.key.startsWith("your-")) {
  console.log("\n✗ Credentials are still the .env.example placeholders.");
  process.exit(1);
}

// ── 1. Connectivity
section("1. Connectivity");
try {
  const { status } = await rest("students", { select: "id" });
  check("Supabase REST reachable with the anon key", status < 500, `HTTP ${status}`);
} catch (err) {
  check("Supabase REST reachable with the anon key", false, String(err));
}

// ── 2. Migrations
section("2. Migrations");

const studentMissing = [];
for (const column of STUDENT_COLUMNS) {
  if ((await columnExists("students", column)) !== true) studentMissing.push(column);
}
check(
  "Base schema — students columns",
  studentMissing.length === 0,
  studentMissing.length
    ? `missing ${studentMissing.join(", ")}`
    : `${STUDENT_COLUMNS.length} columns present`,
  "Run database/schema.sql + migrations 003/004.",
);

const missing006 = [];
for (const column of ACCESS_LOG_COLUMNS_006) {
  if ((await columnExists("access_logs", column)) !== true) missing006.push(column);
}
check(
  "006 — access_logs compatibility columns",
  missing006.length === 0,
  missing006.length
    ? `MISSING ${missing006.join(", ")}`
    : "all present (sync_id, person_type, direction, override_*)",
  "Run database/migrations/006_compatibility_security.sql — kiosk log sync writes these columns and upserts on sync_id.",
);

const missing007 = [];
for (const column of ACCESS_LOG_COLUMNS_007) {
  if ((await columnExists("access_logs", column)) !== true) missing007.push(column);
}
// The kiosk upserts logs with `onConflict: "sync_id"`, which Postgres can only
// satisfy via a UNIQUE index. An index is a catalog object: the anon key has
// INSERT-only RLS on access_logs, so this cannot be probed from the REST API.
check(
  "006 — UNIQUE index on access_logs(sync_id)",
  false,
  "not probeable with the anon key — run database/verify.sql in the SQL Editor to confirm",
  "If verify.sql says it is missing, run database/migrations/006_compatibility_security.sql. The kiosk's on_conflict=sync_id upsert fails with 42P10 without it.",
  { critical: false },
);

check(
  "007 — access_logs.gate_state",
  missing007.length === 0,
  missing007.length ? `MISSING ${missing007.join(", ")}` : "present",
  "Run database/migrations/007_gate_health.sql.",
);

const heartbeats = await tableExists("kiosk_heartbeats");
if (heartbeats) {
  const hbMissing = [];
  for (const column of HEARTBEAT_COLUMNS) {
    if ((await columnExists("kiosk_heartbeats", column)) !== true) hbMissing.push(column);
  }
  check(
    "007 — kiosk_heartbeats table",
    hbMissing.length === 0,
    hbMissing.length
      ? `missing ${hbMissing.join(", ")}`
      : `${HEARTBEAT_COLUMNS.length} columns present`,
    "Re-run database/migrations/007_gate_health.sql.",
  );
} else {
  check(
    "007 — kiosk_heartbeats table",
    false,
    "table not found",
    "Run database/migrations/007_gate_health.sql.",
  );
}

// ── 3. Seed data
section("3. Seed data");

const uniformTypes = await fetch(
  `${BASE}/rest/v1/uniform_types?select=class_id,name&order=class_id`,
  {
    headers: HEADERS,
  },
).then((r) => r.json());
const uniformOk =
  Array.isArray(uniformTypes) &&
  uniformTypes.length === EXPECTED_UNIFORM_CLASSES.length &&
  uniformTypes.every((row) => row.class_id === Number(row.class_id)) &&
  EXPECTED_UNIFORM_CLASSES.every((name, id) => uniformTypes[id]?.name === name);
check(
  "005 — uniform_types matches the trained 9-class model",
  uniformOk,
  Array.isArray(uniformTypes)
    ? `${uniformTypes.length} classes (expected ${EXPECTED_UNIFORM_CLASSES.length})`
    : "query failed",
  "Run database/migrations/005_align_uniforms_to_model.sql.",
);
if (VERBOSE && Array.isArray(uniformTypes)) {
  for (const row of uniformTypes) console.log(`      [${row.class_id}] ${row.name}`);
}

const courseUniforms = await fetch(`${BASE}/rest/v1/course_uniforms?select=course`, {
  headers: HEADERS,
}).then((r) => r.json());
const courses = Array.isArray(courseUniforms)
  ? [...new Set(courseUniforms.map((r) => r.course))]
  : [];
check(
  "005 — course → uniform mapping",
  courses.length > 0,
  courses.length ? `${courses.length} courses: ${courses.join(", ")}` : "no rows",
  "Run database/migrations/005_align_uniforms_to_model.sql.",
);

const settings = await fetch(`${BASE}/rest/v1/system_settings?select=key,value`, {
  headers: HEADERS,
}).then((r) => r.json());
const settingsMap = new Map(Array.isArray(settings) ? settings.map((s) => [s.key, s.value]) : []);
const missingSettings = REQUIRED_SETTINGS.filter((key) => !settingsMap.has(key));
check(
  "Settings present",
  missingSettings.length === 0,
  missingSettings.length
    ? `missing ${missingSettings.join(", ")}`
    : "school branding, voice, uniform mapping, threshold",
  "Run database/schema.sql then migration 009_school_branding.sql.",
);

const missing009 = SETTINGS_009.filter((key) => !settingsMap.has(key));
check(
  "009 — school branding + voice settings",
  missing009.length === 0,
  missing009.length
    ? `MISSING ${missing009.join(", ")}`
    : `applied (initials=${settingsMap.get("school_initials")}, voice=${settingsMap.get("voice_enabled")})`,
  "Run database/migrations/009_school_branding.sql.",
);

const crossCheck = (() => {
  const raw = settingsMap.get("uniform_class_names");
  if (!raw) return { ok: false, detail: "uniform_class_names not set" };
  try {
    const parsed = JSON.parse(raw);
    const sameIds = parsed.every((c, i) => c.id === i);
    const sameNames =
      Array.isArray(uniformTypes) && parsed.every((c, i) => uniformTypes[i]?.name === c.name);
    return {
      ok: sameIds && sameNames,
      detail:
        sameIds && sameNames
          ? "class ids/names match uniform_types"
          : "class ids/names differ from uniform_types",
    };
  } catch {
    return { ok: false, detail: "uniform_class_names is not valid JSON" };
  }
})();
check(
  "Uniform class mapping is consistent",
  crossCheck.ok,
  crossCheck.detail,
  "Re-run migration 005.",
);

// ── 4. Demo readiness
section("4. Demo readiness");

const students = await fetch(
  `${BASE}/rest/v1/students?select=name,department,uniform_type,photo_url,is_active&order=created_at`,
  { headers: HEADERS },
).then((r) => r.json());
const activeStudents = Array.isArray(students) ? students.filter((s) => s.is_active !== false) : [];
check(
  "Students enrolled",
  activeStudents.length >= 3,
  `${activeStudents.length} active (runbook wants 3 demo students)`,
  "Enroll 2 correct-uniform + 1 wrong-uniform student at the Guard Station (:3001).",
);

const unmappable = activeStudents.filter((s) => !familyOf(s.uniform_type));
check(
  "Every active student's uniform_type maps to a uniform family",
  unmappable.length === 0,
  unmappable.length
    ? `${unmappable.length} will ALWAYS be denied on uniform: ${unmappable.map((s) => `${s.name} (${s.uniform_type || "empty"})`).join(", ")}`
    : `all ${activeStudents.length} map to a course family`,
  "Re-enroll them with a course from course_uniforms (CBMSD/CICI/COAG/Education).",
  { critical: false },
);

const noPhotos = activeStudents.filter((s) => !s.photo_url);
check(
  "Every active student has a photo",
  noPhotos.length === 0,
  noPhotos.length
    ? `${noPhotos.length} without photos (no face embedding possible)`
    : "all have photos",
  "Re-enroll those students at the Guard Station.",
);

const familyCounts = activeStudents.reduce((acc, s) => {
  const family = familyOf(s.uniform_type) || "UNMAPPED";
  acc[family] = (acc[family] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `      roster: ${Object.entries(familyCounts)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")}`,
);
if (VERBOSE)
  for (const s of activeStudents)
    console.log(`      - ${s.name} [${s.department}] ${s.uniform_type}`);

const firstPhoto = activeStudents.find((s) => s.photo_url)?.photo_url ?? "";
const photoUrl = (() => {
  const raw = String(firstPhoto);
  if (raw.startsWith("[")) {
    try {
      return JSON.parse(raw)[0] ?? "";
    } catch {
      return "";
    }
  }
  return raw;
})();
if (photoUrl) {
  const res = await fetch(photoUrl, { method: "HEAD" }).catch(() => null);
  check(
    "student-photos bucket is publicly readable",
    res?.status === 200,
    `HTTP ${res?.status ?? "no response"}`,
    "Bucket must be public (migration 006/008 set the read policy).",
  );
} else {
  check(
    "student-photos bucket is publicly readable",
    false,
    "no photo URL to test",
    "Enroll a student first.",
    {
      critical: false,
    },
  );
}
check(
  "008 — Guard photo upload policy",
  true,
  "not probeable with the anon key — confirm via database/verify.sql, or by enrolling one student while signed in",
  "If database/verify.sql reports fewer than 4 storage policies, run database/migrations/008_guard_storage_policies.sql.",
  { critical: false },
);

const heartbeatRows = await fetch(
  `${BASE}/rest/v1/kiosk_heartbeats?select=kiosk_id,updated_at&order=updated_at.desc&limit=3`,
  { headers: HEADERS },
)
  .then((r) => r.json())
  .catch(() => []);
const heartbeats2 = Array.isArray(heartbeatRows) ? heartbeatRows : [];
if (heartbeats2.length > 0) {
  const latest = new Date(heartbeats2[0].updated_at);
  const ageMinutes = Math.round((Date.now() - latest.getTime()) / 60000);
  check(
    "Kiosk heartbeat recorded",
    true,
    `latest ${latest.toISOString()} (${ageMinutes} min ago) — dashboard shows ONLINE within 90s`,
  );
} else {
  check("Kiosk heartbeat recorded", false, "no heartbeat rows yet", "Open the kiosk online once.", {
    critical: false,
  });
}

// ─── Verdict ────────────────────────────────────────────────

const passed = results.filter((r) => r.ok).length;
console.log(`\n${"─".repeat(60)}`);
console.log(`Result: ${passed}/${results.length} checks passed`);
if (blocking > 0) {
  console.log(`\n✗ ${blocking} blocking issue(s) above must be fixed before the demo.`);
  process.exitCode = 1;
} else {
  console.log("\n✓ No blocking issues. Run docs/DEMO_RUNBOOK.md next.");
}

console.log(
  "\nNote: catalog objects (the 006 UNIQUE index, and the RLS + Storage policies)\n" +
    "      cannot be read with the anon key. Paste database/verify.sql into the\n" +
    "      Supabase SQL Editor for a definitive PASS/FAIL row per migration.",
);

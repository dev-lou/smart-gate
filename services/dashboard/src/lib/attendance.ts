/**
 * Attendance helpers — turning raw gate reads into something a teacher can read.
 * =============================================================================
 * Pure functions only, so they can be unit tested without a browser.
 *
 * Two rules shape everything here:
 *
 * 1. The time shown is the SCAN time (`device_timestamp`), never `created_at`.
 *    The kiosk queues reads while it is offline, so upload time can be hours —
 *    or a whole day — after the moment a student actually walked through. The
 *    Access Logs table used to display upload time, which made a backlog of
 *    yesterday's scans all read "2m ago".
 *
 * 2. A student crossing the gate two or three times a day is normal (morning
 *    and afternoon classes). So the log stays a raw audit trail, and the
 *    attendance summary collapses it to one arrival per session: the first
 *    granted read before noon is the AM arrival, the first after noon is PM.
 */

export interface AccessLogLike {
  person_name: string | null;
  success: boolean;
  device_timestamp: string;
  /** Optional so the helper also works on partially selected rows. */
  direction?: string | null;
}

export interface AttendanceRow {
  name: string;
  /** ISO timestamp of the first granted read in the AM session, if any. */
  amFirst: string | null;
  /** ISO timestamp of the first granted read in the PM session, if any. */
  pmFirst: string | null;
  /** Total granted reads today — useful for spotting a kiosk loop. */
  reads: number;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const UNKNOWN_NAME = "Unknown visitor";

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function twelveHour(d: Date): string {
  const hours = d.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hour12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/**
 * Absolute local clock reading, e.g. `Sep 12, 11:03 AM`.
 * Built by hand rather than via `toLocaleString` so the AM/PM form is identical
 * for every viewer and test, regardless of their locale.
 */
export function formatScanTime(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${twelveHour(d)}`;
}

/** Just the clock part, for a compact secondary line: `11:03 AM`. */
export function formatScanClock(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return twelveHour(d);
}

/**
 * Coarse "how long ago", measured against the SCAN time.
 * `now` is injectable so this stays deterministic in tests.
 */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  const d = parse(iso);
  if (!d) return "—";

  const diff = now - d.getTime();
  if (diff < 0) return "just now"; // kiosk clock slightly ahead of the server

  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Which attendance session a moment belongs to. Noon splits the day. */
export function sessionOf(iso: string | null | undefined): "AM" | "PM" | null {
  const d = parse(iso);
  if (!d) return null;
  return d.getHours() < 12 ? "AM" : "PM";
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Collapse a day of granted reads into one arrival per session per person.
 *
 * Denied reads are excluded — a uniform failure is not an arrival. Ordering is
 * by first arrival so the panel reads like a roll call.
 */
export function summarizeDay(
  logs: AccessLogLike[],
  day: Date = new Date(),
  dayLogs: (iso: string) => boolean = () => true,
): AttendanceRow[] {
  const byName = new Map<string, AttendanceRow>();

  for (const log of logs) {
    if (!log.success) continue;
    if (!dayLogs(log.device_timestamp)) continue;

    const at = parse(log.device_timestamp);
    if (!at) continue;
    // Attendance is per calendar day; a 24h window would otherwise mix two.
    if (!sameLocalDay(at, day)) continue;

    const name = (log.person_name || "").trim() || UNKNOWN_NAME;
    const row = byName.get(name) ?? { name, amFirst: null, pmFirst: null, reads: 0 };
    row.reads += 1;

    const session = sessionOf(log.device_timestamp);
    if (session === "AM" && !row.amFirst) row.amFirst = log.device_timestamp;
    if (session === "PM" && !row.pmFirst) row.pmFirst = log.device_timestamp;

    byName.set(name, row);
  }

  return [...byName.values()].sort((a, b) => {
    const aKey = a.amFirst ?? a.pmFirst ?? "";
    const bKey = b.amFirst ?? b.pmFirst ?? "";
    return aKey.localeCompare(bKey);
  });
}

/** Total arrivals (one per session per person) — the number a roll call counts. */
export function countArrivals(rows: AttendanceRow[]): number {
  return rows.reduce((sum, r) => sum + (r.amFirst ? 1 : 0) + (r.pmFirst ? 1 : 0), 0);
}

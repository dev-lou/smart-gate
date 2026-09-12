/**
 * Access-log time and attendance tests.
 *
 * These cover the two things that made the Access Logs page unreadable:
 *   1. showing upload time (`created_at`) instead of scan time
 *      (`device_timestamp`), so a backlog all read "2m ago";
 *   2. counting every gate read as an arrival, when a student crossing twice a
 *      day (morning and afternoon class) is completely normal.
 */

import { describe, it, expect } from "vitest";
import {
  countArrivals,
  formatRelative,
  formatScanClock,
  formatScanTime,
  sessionOf,
  summarizeDay,
  type AccessLogLike,
} from "../attendance";

function log(person_name: string | null, device_timestamp: string, success = true): AccessLogLike {
  return { person_name, device_timestamp, success };
}

// Local-time ISO strings (no Z) so the assertions do not depend on the test
// runner's timezone.
const MORNING = "2026-09-12T07:42:11";
const BEFORE_NOON = "2026-09-12T11:59:00";
const AFTERNOON = "2026-09-12T13:15:03";

describe("scan time formatting", () => {
  it("renders the scan moment with an explicit AM/PM clock", () => {
    expect(formatScanTime(MORNING)).toBe("Sep 12, 7:42 AM");
    expect(formatScanTime("2026-09-12T15:05:00")).toBe("Sep 12, 3:05 PM");
  });

  it("handles the 12 o'clock edges without showing 0:00 or 24:00", () => {
    expect(formatScanTime("2026-09-12T00:05:00")).toBe("Sep 12, 12:05 AM");
    expect(formatScanTime("2026-09-12T12:05:00")).toBe("Sep 12, 12:05 PM");
  });

  it("gives a compact clock for the attendance panel", () => {
    expect(formatScanClock(MORNING)).toBe("7:42 AM");
    expect(formatScanClock(AFTERNOON)).toBe("1:15 PM");
  });

  it("degrades to a dash on missing or unparseable timestamps", () => {
    expect(formatScanTime(null)).toBe("—");
    expect(formatScanTime("not a date")).toBe("—");
    expect(formatScanClock(undefined)).toBe("—");
  });
});

describe("relative time", () => {
  const now = new Date("2026-09-12T10:00:00").getTime();

  it("measures against the SCAN time, not the upload time", () => {
    // Scanned 2 hours before "now" — reads as 2h ago even if it just uploaded.
    expect(formatRelative("2026-09-12T08:00:00", now)).toBe("2h ago");
    expect(formatRelative("2026-09-12T09:30:00", now)).toBe("30m ago");
    expect(formatRelative("2026-09-12T09:59:30", now)).toBe("just now");
  });

  it("counts whole days for older scans", () => {
    expect(formatRelative("2026-09-10T10:00:00", now)).toBe("2d ago");
  });

  it("tolerates a kiosk clock running slightly ahead of the server", () => {
    expect(formatRelative("2026-09-12T10:00:30", now)).toBe("just now");
  });
});

describe("session bucketing", () => {
  it("splits the day at noon", () => {
    expect(sessionOf(MORNING)).toBe("AM");
    expect(sessionOf(BEFORE_NOON)).toBe("AM");
    expect(sessionOf(AFTERNOON)).toBe("PM");
    expect(sessionOf(null)).toBe(null);
  });
});

describe("daily attendance summary", () => {
  const day = new Date("2026-09-12T23:00:00");

  it("collapses repeated reads into one arrival per session", () => {
    const rows = summarizeDay(
      [
        log("Lou", MORNING),
        log("Lou", "2026-09-12T07:42:16"),
        log("Lou", "2026-09-12T07:42:21"),
        log("Lou", AFTERNOON),
      ],
      day,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Lou");
    expect(formatScanClock(rows[0].amFirst)).toBe("7:42 AM");
    expect(formatScanClock(rows[0].pmFirst)).toBe("1:15 PM");
    // The raw read count is still exposed, so a kiosk loop stays visible.
    expect(rows[0].reads).toBe(4);
    expect(countArrivals(rows)).toBe(2);
  });

  it("counts an afternoon-only visit as one PM arrival", () => {
    const rows = summarizeDay([log("Shamy", AFTERNOON)], day);
    expect(rows[0].amFirst).toBe(null);
    expect(formatScanClock(rows[0].pmFirst)).toBe("1:15 PM");
    expect(countArrivals(rows)).toBe(1);
  });

  it("ignores denied reads — a uniform failure is not an arrival", () => {
    const rows = summarizeDay(
      [log("Lou", MORNING, false), log("Lou", MORNING, false), log("Lou", AFTERNOON, true)],
      day,
    );
    expect(rows[0].amFirst).toBe(null);
    expect(rows[0].reads).toBe(1);
    expect(countArrivals(rows)).toBe(1);
  });

  it("ignores reads from other days", () => {
    const rows = summarizeDay([log("Lou", "2026-09-11T07:42:00"), log("Lou", MORNING)], day);
    expect(rows[0].reads).toBe(1);
    expect(formatScanClock(rows[0].amFirst)).toBe("7:42 AM");
  });

  it("names records without a person instead of dropping them", () => {
    const rows = summarizeDay([log(null, MORNING)], day);
    expect(rows[0].name).toBe("Unknown visitor");
    expect(countArrivals(rows)).toBe(1);
  });

  it("orders the roll call by first arrival", () => {
    const rows = summarizeDay(
      [log("Zara", AFTERNOON), log("Lou", MORNING), log("Miguel", "2026-09-12T09:00:00")],
      day,
    );
    expect(rows.map((r) => r.name)).toEqual(["Lou", "Miguel", "Zara"]);
  });

  it("returns nothing for an empty day", () => {
    expect(summarizeDay([], day)).toEqual([]);
    expect(countArrivals([])).toBe(0);
  });
});

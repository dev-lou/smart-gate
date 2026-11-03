/**
 * Guest E-Pass validity tests
 * ===========================
 * These exercise the real decision function the kiosk uses, with fixed
 * instants, so a pass "working" is a measured fact rather than an assumption.
 */

import { describe, it, expect } from "vitest";
import { evaluateGuestPass } from "../accessPolicy";

const iso = (ms: number) => new Date(ms).toISOString();

describe("evaluateGuestPass", () => {
  const expiry = Date.parse("2026-11-02T16:09:00+00:00"); // shape Supabase returns

  it("denies a pass whose instant has passed", () => {
    const r = evaluateGuestPass("2026-11-02T16:09:00+00:00", expiry + 1000);
    expect(r.expired).toBe(true);
    expect(r.expiryLabel.length).toBeGreaterThan(0);
  });

  it("allows a pass one minute before expiry", () => {
    expect(evaluateGuestPass("2026-11-02T16:09:00+00:00", expiry - 60_000).expired).toBe(false);
  });

  it("allows a pass at the exact expiry instant, denies one millisecond later", () => {
    expect(evaluateGuestPass("2026-11-02T16:09:00+00:00", expiry).expired).toBe(false);
    expect(evaluateGuestPass("2026-11-02T16:09:00+00:00", expiry + 1).expired).toBe(true);
  });

  it("compares instants, not clock text: +08:00 and Z forms agree", () => {
    const manila = "2026-11-03T00:09:00+08:00"; // same instant as 16:09Z
    expect(Date.parse(manila)).toBe(expiry);
    expect(evaluateGuestPass(manila, expiry - 1).expired).toBe(false);
    expect(evaluateGuestPass(manila, expiry + 1).expired).toBe(true);
  });

  it("handles the guard's toISOString() output", () => {
    const saved = new Date(Date.parse("2026-11-02T18:00:00+08:00")).toISOString();
    expect(saved).toBe("2026-11-02T10:00:00.000Z");
    expect(evaluateGuestPass(saved, Date.parse("2026-11-02T09:59:59Z")).expired).toBe(false);
    expect(evaluateGuestPass(saved, Date.parse("2026-11-02T10:00:01Z")).expired).toBe(true);
  });

  it("treats the guard's blank-field default of 6PM local as that day's 6PM", () => {
    const sixPm = new Date(2026, 10, 2, 18, 0, 0, 0); // local wall clock 18:00
    expect(evaluateGuestPass(sixPm.toISOString(), sixPm.getTime() - 1).expired).toBe(false);
    expect(evaluateGuestPass(sixPm.toISOString(), sixPm.getTime() + 1).expired).toBe(true);
  });

  it("does not deny when no expiry is configured", () => {
    for (const v of [null, undefined, "", "   "]) {
      const r = evaluateGuestPass(v as string | null | undefined, expiry);
      expect(r.expired).toBe(false);
      expect(r.expiryLabel).toBe("");
    }
  });

  it("does not deny on an unparseable value (data problem must not block the gate)", () => {
    expect(evaluateGuestPass("not-a-date", expiry).expired).toBe(false);
    expect(evaluateGuestPass("18:00", expiry).expired).toBe(false);
  });

  it("stays correct across a year boundary", () => {
    const newYear = Date.parse("2027-01-01T00:00:00+08:00");
    expect(evaluateGuestPass(iso(newYear), newYear - 1).expired).toBe(false);
    expect(evaluateGuestPass(iso(newYear), newYear + 1).expired).toBe(true);
  });
});

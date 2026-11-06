import { describe, expect, it } from "vitest";
import { QR_FRESH_MS, encodeStudentQr, evaluateScannedQr, isQrFresh, parseQrPayload } from "../qr";

describe("encodeStudentQr / parseQrPayload", () => {
  it("round-trips a student ID", () => {
    expect(parseQrPayload(encodeStudentQr("CICT-2023-0449"))).toBe("CICT-2023-0449");
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseQrPayload("  SG1:0546  ")).toBe("0546");
  });

  it("accepts a lower-case prefix", () => {
    expect(parseQrPayload("sg1:0543")).toBe("0543");
  });

  it("ignores an unrelated QR code", () => {
    expect(parseQrPayload("https://example.com/menu")).toBeNull();
  });

  it("ignores an empty payload and a payload with no ID", () => {
    expect(parseQrPayload("")).toBeNull();
    expect(parseQrPayload(null)).toBeNull();
    expect(parseQrPayload("SG1:   ")).toBeNull();
  });

  it("rejects an oversized payload", () => {
    expect(parseQrPayload("SG1:" + "9".repeat(200))).toBeNull();
  });
});

describe("isQrFresh", () => {
  const now = 1_000_000;

  it("is fresh at the moment it was read", () => {
    expect(isQrFresh(now, now)).toBe(true);
  });

  it("is fresh exactly one millisecond before the window closes", () => {
    expect(isQrFresh(now - QR_FRESH_MS + 1, now)).toBe(true);
  });

  it("is stale exactly one millisecond after the window closes", () => {
    expect(isQrFresh(now - QR_FRESH_MS - 1, now)).toBe(false);
  });

  it("treats a missing read as stale", () => {
    expect(isQrFresh(0, now)).toBe(false);
  });
});

describe("evaluateScannedQr", () => {
  const now = 1_000_000;
  const enrolled = ["CICT-2023-0449", "0546"];
  const fresh = { studentId: "CICT-2023-0449", seenAt: now - 100 };
  const base = { allowQr: true, now, enrolledStudentIds: enrolled };

  it("resolves a code that belongs to an enrolled student", () => {
    expect(evaluateScannedQr({ ...base, qr: fresh })).toEqual({
      code: "ENROLLED",
      studentId: "CICT-2023-0449",
    });
  });

  it("matches case-blind and trimmed, handing back the enrolled spelling", () => {
    expect(
      evaluateScannedQr({ ...base, qr: { studentId: " cict-2023-0449 ", seenAt: now - 10 } }),
    ).toEqual({ code: "ENROLLED", studentId: "CICT-2023-0449" });
  });

  it("reports a code nobody is enrolled under", () => {
    expect(
      evaluateScannedQr({ ...base, qr: { studentId: "2022-0001", seenAt: now - 10 } }),
    ).toEqual({ code: "UNKNOWN", studentId: "2022-0001" });
  });

  it("reports a stale code as stale rather than opening on it", () => {
    expect(
      evaluateScannedQr({
        ...base,
        qr: { studentId: "0546", seenAt: now - QR_FRESH_MS - 1 },
      }),
    ).toEqual({ code: "STALE" });
  });

  it("does nothing when no code is in front of the camera", () => {
    expect(evaluateScannedQr({ ...base, qr: null })).toEqual({ code: "NO_CODE" });
  });

  it("is disabled when the operator turns the fallback off", () => {
    expect(evaluateScannedQr({ ...base, allowQr: false, qr: fresh })).toEqual({
      code: "DISABLED",
    });
  });
});

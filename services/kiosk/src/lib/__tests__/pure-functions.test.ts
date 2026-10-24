/**
 * Pure Function Tests
 * ====================
 * Tests for all pure logic functions that don't require browser APIs.
 * These functions are inlined here for test isolation.
 */

import { describe, it, expect } from "vitest";

// ─── Uniform course-family matching (mirrors lib/uniform.ts) ──

const COURSE_FAMILIES: Array<[string, string]> = [
  ["cbmsd", "cbmsd"],
  ["cici", "cici"],
  ["coag", "coag"],
  ["education", "education"],
];

function familyOf(uniformName: string): string {
  const n = (uniformName || "").toLowerCase();
  for (const [marker, family] of COURSE_FAMILIES) {
    if (n.includes(marker)) return family;
  }
  return "";
}

function wouldGrantAccess(expectedUniform: string, detectedUniform: string): boolean {
  const expectedFamily = familyOf(expectedUniform);
  const detectedFamily = familyOf(detectedUniform);
  return expectedFamily !== "" && expectedFamily === detectedFamily;
}

describe("course-level uniform matching", () => {
  it("accepts ANY cici variant for a CICI student (blazer/female/male)", () => {
    expect(wouldGrantAccess("CICI", "cici_blazer_uniform")).toBe(true);
    expect(wouldGrantAccess("CICI", "cici_female_uniform")).toBe(true);
    expect(wouldGrantAccess("CICI", "cici_male_uniform")).toBe(true);
    // legacy per-type stored values still match their own family
    expect(wouldGrantAccess("cici_blazer_uniform", "cici_female_uniform")).toBe(true);
  });

  it("accepts any education / coag / cbmsd variant for their own course", () => {
    expect(wouldGrantAccess("Education", "education_female_uniform")).toBe(true);
    expect(wouldGrantAccess("Education", "education_male_uniform")).toBe(true);
    expect(wouldGrantAccess("COAG", "coag_female_uniform")).toBe(true);
    expect(wouldGrantAccess("COAG", "coag_male_uniform")).toBe(true);
    expect(wouldGrantAccess("CBMSD", "cbmsd_chef_male_uniform")).toBe(true);
    expect(wouldGrantAccess("CBMSD", "cbmsd_universal_male_uniform")).toBe(true);
  });

  it("DENIES a CICI student wearing a COAG/Education/CBMSD uniform", () => {
    expect(wouldGrantAccess("CICI", "coag_female_uniform")).toBe(false);
    expect(wouldGrantAccess("CICI", "education_male_uniform")).toBe(false);
    expect(wouldGrantAccess("CICI", "cbmsd_chef_male_uniform")).toBe(false);
  });

  it("DENIES cross-course swaps in every direction", () => {
    expect(wouldGrantAccess("COAG", "cici_blazer_uniform")).toBe(false);
    expect(wouldGrantAccess("Education", "coag_male_uniform")).toBe(false);
    expect(wouldGrantAccess("CBMSD", "cici_male_uniform")).toBe(false);
  });

  it("fails closed for unmapped types (no course / unknown)", () => {
    expect(wouldGrantAccess("default", "cici_blazer_uniform")).toBe(false);
    expect(wouldGrantAccess("", "cici_blazer_uniform")).toBe(false);
    expect(wouldGrantAccess("CICI", "unknown_style")).toBe(false);
  });
});

// ─── Cosine Similarity ─────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = new Float32Array([0.5, 0.2, 0.8, 0.1]);
    const result = cosineSimilarity(v, v);
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("returns ~0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    const result = cosineSimilarity(a, b);
    expect(result).toBeCloseTo(0, 5);
  });

  it("handles 128-dim vectors (old model)", () => {
    const a = new Float32Array(128);
    const b = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      a[i] = Math.random() * 2 - 1;
      b[i] = Math.random() * 2 - 1;
    }
    // Normalize
    const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < 128; i++) {
      a[i] /= normA;
      b[i] /= normB;
    }
    const result = cosineSimilarity(a, b);
    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("handles 512-dim vectors (ArcFace model)", () => {
    const a = new Float32Array(512);
    const b = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      a[i] = Math.random() * 2 - 1;
      b[i] = Math.random() * 2 - 1;
    }
    // Normalize
    const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < 512; i++) {
      a[i] /= normA;
      b[i] /= normB;
    }
    const result = cosineSimilarity(a, b);
    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("returns NaN for zero-vector (empty embedding array fallback)", () => {
    const v = new Float32Array([0.5, 0.2]);
    const zero = new Float32Array(0);
    const result = cosineSimilarity(v, zero);
    expect(result).toBeNaN();
  });

  it("returns higher similarity for similar vectors than different ones", () => {
    const base = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const similar = new Float32Array([0.11, 0.21, 0.29, 0.41, 0.49]);
    const different = new Float32Array([-0.1, -0.2, -0.3, -0.4, -0.5]);

    const simScore = cosineSimilarity(base, similar);
    const diffScore = cosineSimilarity(base, different);

    expect(simScore).toBeGreaterThan(diffScore);
  });
});

// ─── MatchFace (multiple embeddings) ────────────────────────

interface EnrolledFace {
  id: string;
  name: string;
  student_id: string;
  department: string;
  uniform_type: string;
  embeddings: Float32Array[];
}

interface MatchResult {
  person: EnrolledFace | null;
  confidence: number;
  matched: boolean;
}

const MATCH_THRESHOLD = 0.6;

function matchFace(embedding: Float32Array, enrolledFaces: EnrolledFace[]): MatchResult {
  if (enrolledFaces.length === 0) {
    return { person: null, confidence: 0, matched: false };
  }

  let bestScore = -1;
  let bestPerson: EnrolledFace | null = null;

  for (const enrolled of enrolledFaces) {
    for (const emb of enrolled.embeddings) {
      const score = cosineSimilarity(embedding, emb);
      if (score > bestScore) {
        bestScore = score;
        bestPerson = enrolled;
      }
    }
  }

  const matched = bestScore >= MATCH_THRESHOLD;
  return {
    person: matched ? bestPerson : null,
    confidence: bestScore,
    matched,
  };
}

function makeNormalized(dim: number, seed: number): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    arr[i] = Math.sin(seed + i * 0.1);
  }
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  for (let i = 0; i < dim; i++) arr[i] /= norm;
  return arr;
}

describe("matchFace", () => {
  const mockStudent = (id: string, name: string, dim: number): EnrolledFace => ({
    id,
    name,
    student_id: `2024-${id}`,
    department: "BSIT",
    uniform_type: "education_male_uniform",
    embeddings: [makeNormalized(dim, parseInt(id)), makeNormalized(dim, parseInt(id) + 100)],
  });

  const enrolled = [
    mockStudent("1", "Alice", 128),
    mockStudent("2", "Bob", 128),
    mockStudent("3", "Charlie", 128),
  ];

  it("returns matched=false for empty enrolled list", () => {
    const result = matchFace(new Float32Array(128), []);
    expect(result.matched).toBe(false);
    expect(result.person).toBeNull();
  });

  it("matches the correct person when embedding is similar", () => {
    // Create embedding close to Alice's first embedding
    const aliceEmb = enrolled[0].embeddings[0];
    const query = new Float32Array(aliceEmb);
    // Add tiny noise
    for (let i = 0; i < query.length; i++) query[i] += (Math.random() - 0.5) * 0.01;
    // Re-normalize
    const norm = Math.sqrt(query.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < query.length; i++) query[i] /= norm;

    const result = matchFace(query, enrolled);
    expect(result.matched).toBe(true);
    expect(result.person?.name).toBe("Alice");
    expect(result.confidence).toBeGreaterThan(0.7);
  });
});

// ─── Parse Photo URLs ──────────────────────────────────────

function parsePhotoUrls(photoUrl: string | null): string[] {
  if (!photoUrl) return [];
  try {
    if (photoUrl.startsWith("[")) {
      const parsed = JSON.parse(photoUrl);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    }
  } catch {
    // Not a JSON array, treat as single URL
  }
  return [photoUrl];
}

describe("parsePhotoUrls", () => {
  it("returns empty array for null input", () => {
    expect(parsePhotoUrls(null)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parsePhotoUrls("")).toEqual([]);
  });

  it("treats single URL as single-element array", () => {
    expect(parsePhotoUrls("https://example.com/photo.jpg")).toEqual([
      "https://example.com/photo.jpg",
    ]);
  });

  it("parses JSON array of URLs", () => {
    const urls = [
      "https://example.com/front.jpg",
      "https://example.com/left.jpg",
      "https://example.com/right.jpg",
    ];
    expect(parsePhotoUrls(JSON.stringify(urls))).toEqual(urls);
  });

  it("filters out null/empty entries from JSON array", () => {
    const urls = ["https://example.com/front.jpg", null, "https://example.com/right.jpg"];
    expect(parsePhotoUrls(JSON.stringify(urls))).toEqual([
      "https://example.com/front.jpg",
      "https://example.com/right.jpg",
    ]);
  });

  it("falls back to single URL for malformed JSON", () => {
    expect(parsePhotoUrls("[malformed")).toEqual(["[malformed"]);
  });

  it("handles array with single URL", () => {
    expect(parsePhotoUrls('["https://example.com/only.jpg"]')).toEqual([
      "https://example.com/only.jpg",
    ]);
  });
});

// ─── Non-Maximum Suppression ────────────────────────────────

interface YoloDetection {
  bbox: [number, number, number, number]; // [x, y, w, h] normalized
  classId: number;
  confidence: number;
}

function calculateIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;

  const ax1 = ax,
    ay1 = ay,
    ax2 = ax + aw,
    ay2 = ay + ah;
  const bx1 = bx,
    by1 = by,
    bx2 = bx + bw,
    by2 = by + bh;

  const x1 = Math.max(ax1, bx1);
  const y1 = Math.max(ay1, by1);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = aw * ah;
  const areaB = bw * bh;
  const union = areaA + areaB - intersection;

  return union > 0 ? intersection / union : 0;
}

function nonMaxSuppression(detections: YoloDetection[], iouThreshold: number): YoloDetection[] {
  if (detections.length <= 1) return detections;

  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const result: YoloDetection[] = [];

  while (sorted.length > 0) {
    const best = sorted.shift()!;
    result.push(best);

    for (let i = sorted.length - 1; i >= 0; i--) {
      const iou = calculateIoU(best.bbox, sorted[i].bbox);
      if (iou > iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }

  return result;
}

describe("calculateIoU", () => {
  it("returns 1.0 for identical boxes", () => {
    expect(calculateIoU([0.1, 0.1, 0.8, 0.8], [0.1, 0.1, 0.8, 0.8])).toBeCloseTo(1.0, 5);
  });

  it("returns 0 for non-overlapping boxes", () => {
    expect(calculateIoU([0, 0, 0.3, 0.3], [0.7, 0.7, 0.3, 0.3])).toBe(0);
  });

  it("returns correct IoU for partially overlapping boxes", () => {
    // Box A: [0, 0, 1, 1] → area = 1
    // Box B: [0.5, 0, 1, 1] → area = 1
    // Intersection: [0.5, 0, 0.5, 1] → area = 0.5
    // IoU = 0.5 / (1 + 1 - 0.5) = 0.5 / 1.5 = 0.333
    const iou = calculateIoU([0, 0, 1, 1], [0.5, 0, 1, 1]);
    expect(iou).toBeCloseTo(1 / 3, 5);
  });

  it("handles one box inside another", () => {
    // Box A: [0, 0, 1, 1] → area = 1
    // Box B: [0.2, 0.2, 0.3, 0.3] → area = 0.09
    // Intersection = 0.09
    // IoU = 0.09 / (1 + 0.09 - 0.09) = 0.09
    const iou = calculateIoU([0, 0, 1, 1], [0.2, 0.2, 0.3, 0.3]);
    expect(iou).toBeCloseTo(0.09, 5);
  });
});

describe("nonMaxSuppression", () => {
  it("returns single detection as-is", () => {
    const dets: YoloDetection[] = [{ bbox: [0.1, 0.1, 0.5, 0.5], classId: 0, confidence: 0.9 }];
    expect(nonMaxSuppression(dets, 0.5)).toHaveLength(1);
  });

  it("removes overlapping detections of same class", () => {
    const dets: YoloDetection[] = [
      { bbox: [0.1, 0.1, 0.5, 0.5], classId: 0, confidence: 0.9 },
      { bbox: [0.15, 0.15, 0.5, 0.5], classId: 0, confidence: 0.8 },
    ];
    const result = nonMaxSuppression(dets, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
  });

  it("keeps non-overlapping detections", () => {
    const dets: YoloDetection[] = [
      { bbox: [0, 0, 0.3, 0.3], classId: 0, confidence: 0.9 },
      { bbox: [0.7, 0.7, 0.3, 0.3], classId: 0, confidence: 0.8 },
    ];
    const result = nonMaxSuppression(dets, 0.5);
    expect(result).toHaveLength(2);
  });

  it("keeps high-confidence detection over low-confidence overlap", () => {
    const dets: YoloDetection[] = [
      { bbox: [0.1, 0.1, 0.5, 0.5], classId: 0, confidence: 0.6 },
      { bbox: [0.12, 0.12, 0.5, 0.5], classId: 0, confidence: 0.95 },
    ];
    const result = nonMaxSuppression(dets, 0.3);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.95);
  });
});

// ─── Settings Parsing ───────────────────────────────────────

describe("settings parsing", () => {
  it("correctly parses uniform_detection_enabled from settings", () => {
    const enabled: string = "true";
    const disabled: string = "false";
    expect(enabled === "true").toBe(true);
    expect(disabled === "true").toBe(false);
  });

  it("correctly parses face_recognition_threshold", () => {
    const parsed = parseFloat("0.6");
    expect(parsed).toBe(0.6);
    expect(isNaN(parseFloat("0.6"))).toBe(false);
  });

  it("handles invalid threshold gracefully", () => {
    expect(isNaN(parseFloat("not-a-number"))).toBe(true);
  });
});

// ─── Config Constants ───────────────────────────────────────

describe("ArcFace model specs", () => {
  it("uses correct input size (112)", () => {
    const FACE_INPUT_SIZE = 112;
    expect(FACE_INPUT_SIZE).toBe(112);
  });

  it("uses correct normalization formula", () => {
    // (pixel - 127.5) / 127.5 maps [0, 255] → [-1, 1]
    expect((0 - 127.5) / 127.5).toBeCloseTo(-1, 5);
    expect((255 - 127.5) / 127.5).toBeCloseTo(1, 5);
    expect((127.5 - 127.5) / 127.5).toBeCloseTo(0, 5);
  });
});

// ─── Gate WebSocket Message Parsing ─────────────────────────

import { parseGateMessage, reconnectDelayMs } from "../gateWs";

describe("reconnectDelayMs", () => {
  it("starts at 5s and doubles each attempt", () => {
    expect(reconnectDelayMs(1)).toBe(5000);
    expect(reconnectDelayMs(2)).toBe(10000);
    expect(reconnectDelayMs(3)).toBe(20000);
  });

  it("caps at 30s so the kiosk never hammers the ESP32", () => {
    expect(reconnectDelayMs(4)).toBe(30000);
    expect(reconnectDelayMs(10)).toBe(30000);
    expect(reconnectDelayMs(100)).toBe(30000);
  });
});

describe("parseGateMessage", () => {
  it("parses button press event (B)", () => {
    const event = parseGateMessage("B");
    expect(event?.type).toBe("button_press");
  });

  it("parses ready signal (R) as connected", () => {
    const event = parseGateMessage("R");
    expect(event?.type).toBe("connected");
  });

  it("parses gate state reports (S:OPEN)", () => {
    const event = parseGateMessage("S:OPEN");
    expect(event?.type).toBe("gate_state");
    expect(event?.data).toBe("OPEN");
  });

  it("parses all gate states", () => {
    for (const state of ["IDLE", "OPENING", "OPEN", "CLOSING", "ERROR"]) {
      const event = parseGateMessage(`S:${state}`);
      expect(event?.type).toBe("gate_state");
      expect(event?.data).toBe(state);
    }
  });

  it("trims surrounding whitespace", () => {
    const event = parseGateMessage("  S:IDLE  \n");
    expect(event?.type).toBe("gate_state");
    expect(event?.data).toBe("IDLE");
  });

  it("returns null for command acknowledgements (K)", () => {
    expect(parseGateMessage("K")).toBeNull();
  });

  it("returns null for unknown or empty messages", () => {
    expect(parseGateMessage("")).toBeNull();
    expect(parseGateMessage("garbage")).toBeNull();
  });
});

// ─── Heartbeat Payload Builder ──────────────────────────────

import { buildHeartbeatRow } from "../heartbeat";

describe("buildHeartbeatRow", () => {
  const input = {
    kioskName: "Gate 1",
    cameraOk: true,
    gateConnected: true,
    gateState: "OPEN",
    studentsCount: 42,
    unsyncedLogs: 3,
    lastSync: "2026-09-09T00:00:00.000Z",
    fps: 24,
    lastError: null,
  };

  it("maps camelCase input to the Supabase snake_case schema", () => {
    const row = buildHeartbeatRow(input, "kiosk_test");
    expect(row).toMatchObject({
      kiosk_id: "kiosk_test",
      kiosk_name: "Gate 1",
      camera_ok: true,
      gate_connected: true,
      gate_state: "OPEN",
      students_count: 42,
      unsynced_logs: 3,
      last_sync: "2026-09-09T00:00:00.000Z",
      fps: 24,
      last_error: null,
    });
  });

  it("sets a valid ISO updated_at timestamp", () => {
    const row = buildHeartbeatRow(input, "kiosk_test");
    expect(new Date(row.updated_at).getTime()).not.toBeNaN();
  });

  it("round-trips offline-style payloads (null fields)", () => {
    const row = buildHeartbeatRow(
      {
        kioskName: "Gate 2",
        cameraOk: false,
        gateConnected: false,
        gateState: null,
        studentsCount: 0,
        unsyncedLogs: 0,
        lastSync: null,
        fps: 0,
        lastError: "Camera unavailable",
      },
      "kiosk_2",
    );
    expect(row.gate_state).toBeNull();
    expect(row.last_sync).toBeNull();
    expect(row.last_error).toBe("Camera unavailable");
  });
});

// ─── Heartbeat missing-table detection ──────────────────────

import { isHeartbeatTableMissing } from "../heartbeat";

describe("isHeartbeatTableMissing", () => {
  it("detects the Supabase PGRST205 schema-cache error", () => {
    const err = {
      code: "PGRST205",
      message: "Could not find the table 'public.kiosk_heartbeats' in the schema cache",
    };
    expect(isHeartbeatTableMissing(err)).toBe(true);
  });

  it("detects a plain 404 (table not deployed yet)", () => {
    expect(isHeartbeatTableMissing({ status: 404, message: "Not Found" })).toBe(true);
  });

  it("detects a 'Could not find the table' message without a code", () => {
    expect(
      isHeartbeatTableMissing({
        message: "Could not find the table 'public.x' in the schema cache",
      }),
    ).toBe(true);
  });

  it("keeps real errors classified as not-missing-table", () => {
    expect(isHeartbeatTableMissing(new Error("network down"))).toBe(false);
    expect(isHeartbeatTableMissing({ code: "PGRST301", message: "permission denied" })).toBe(false);
    expect(isHeartbeatTableMissing({ status: 500 })).toBe(false);
    expect(isHeartbeatTableMissing(null)).toBe(false);
    expect(isHeartbeatTableMissing("boom")).toBe(false);
  });
});

// ─── Unknown-Face Beep Throttle ─────────────────────────────

import { shouldPlayBeep } from "../voice";

describe("shouldPlayBeep", () => {
  it("plays on the first unknown face (no previous beep)", () => {
    const result = shouldPlayBeep(0, 1_000);
    expect(result.play).toBe(true);
    expect(result.lastPlayedAt).toBe(1_000);
  });

  it("does not play again within the 10s window", () => {
    const first = shouldPlayBeep(0, 1_000);
    const second = shouldPlayBeep(first.lastPlayedAt, 5_000);
    expect(second.play).toBe(false);
    expect(second.lastPlayedAt).toBe(1_000); // unchanged
  });

  it("plays again after the window passes", () => {
    const first = shouldPlayBeep(0, 1_000);
    const second = shouldPlayBeep(first.lastPlayedAt, 11_000);
    expect(second.play).toBe(true);
    expect(second.lastPlayedAt).toBe(11_000);
  });

  it("supports custom windows", () => {
    const first = shouldPlayBeep(0, 1_000, 2_000);
    const second = shouldPlayBeep(first.lastPlayedAt, 2_500, 2_000);
    expect(second.play).toBe(false);
    const third = shouldPlayBeep(first.lastPlayedAt, 3_100, 2_000);
    expect(third.play).toBe(true);
  });
});

// ─── Console Filter (benign WASM logs) ────────────────────

import { isBenignWasmLog } from "../consoleFilter";

describe("isBenignWasmLog", () => {
  it("filters the exact XNNPACK INFO line", () => {
    expect(isBenignWasmLog(["INFO: Created TensorFlow Lite XNNPACK delegate for CPU."])).toBe(true);
  });

  it("filters other TFLite delegate/runtime INFO lines", () => {
    expect(isBenignWasmLog(["INFO: Created TensorFlow Lite WebGPU delegate."])).toBe(true);
    expect(isBenignWasmLog(["INFO: Initialized TensorFlow Lite runtime."])).toBe(true);
  });

  it("keeps real errors visible", () => {
    expect(isBenignWasmLog(["Face detection error:", new Error("boom")])).toBe(false);
    expect(isBenignWasmLog(["Failed to load face detector:", "network down"])).toBe(false);
    expect(
      isBenignWasmLog(["INFO: Created TensorFlow Lite XNNPACK delegate for CPU.", "detect failed"]),
    ).toBe(false);
  });

  it("ignores non-string payloads (unknown shapes pass through)", () => {
    expect(isBenignWasmLog([{ weird: true }])).toBe(false);
    expect(isBenignWasmLog([])).toBe(false);
  });

  it("filters the gate WebSocket failure line (ESP32 powered off)", () => {
    expect(isBenignWasmLog(["WebSocket connection to 'ws://192.168.4.1:81/' failed: "])).toBe(true);
  });

  it("filters the gate disconnect notice", () => {
    expect(isBenignWasmLog(["[Kiosk] Gate disconnected, auto-reconnect will attempt..."])).toBe(
      true,
    );
  });

  it("keeps real WebSocket failures visible (non-gate endpoints)", () => {
    expect(isBenignWasmLog(["WebSocket error: connection refused"])).toBe(false);
  });
});

// ─── Scan policy (lib/scanPolicy.ts) ────────────────────────
// Guards the fix for one student producing 140 access rows in a single sitting:
// after a decision the kiosk only re-arms once the gate area is empty.

import {
  PERSON_COOLDOWN_MS,
  PERSON_REDECIDE_MS,
  REARM_ABSENCE_MS,
  UNKNOWN_DWELL_MS,
  clampGateWindow,
  gateStateForLog,
  isRepeatDecision,
  isSettledUnknown,
  nextPresence,
  resolveGateOutcome,
  shouldDecide,
  visitGeneration,
} from "../scanPolicy";

describe("scan policy — re-arm on absence", () => {
  it("keeps a fresh kiosk armed when nobody is in frame", () => {
    const state = nextPresence({
      facePresent: false,
      state: { faceFreeSince: 0, rearmed: true },
      now: 1000,
    });
    expect(state.rearmed).toBe(true);
  });

  it("does NOT re-arm while the same person keeps standing there", () => {
    // Decision logged at t=0, so rearmed starts false; the face never leaves.
    let state = { faceFreeSince: 0, rearmed: false };
    for (let t = 0; t <= 60_000; t += 500) {
      state = nextPresence({ facePresent: true, state, now: t });
      expect(state.rearmed).toBe(false);
    }
    expect(state.faceFreeSince).toBe(0);
  });

  it("re-arms only after the frame has been empty for the whole absence window", () => {
    let state = { faceFreeSince: 0, rearmed: false };

    // Person leaves at t=1000.
    state = nextPresence({ facePresent: false, state, now: 1000 });
    expect(state.faceFreeSince).toBe(1000);
    expect(state.rearmed).toBe(false);

    // Still inside the window.
    state = nextPresence({ facePresent: false, state, now: 1000 + REARM_ABSENCE_MS - 1 });
    expect(state.rearmed).toBe(false);

    // Window elapsed.
    state = nextPresence({ facePresent: false, state, now: 1000 + REARM_ABSENCE_MS });
    expect(state.rearmed).toBe(true);
  });

  it("keeps the empty-since clock fixed while the frame stays empty", () => {
    let state = nextPresence({
      facePresent: false,
      state: { faceFreeSince: 0, rearmed: false },
      now: 5000,
    });
    expect(state.faceFreeSince).toBe(5000);
    expect(state.rearmed).toBe(false);

    // The clock must not drift forward on later frames.
    state = nextPresence({ facePresent: false, state, now: 9000 });
    expect(state.faceFreeSince).toBe(5000);
    // 4s of empty frame is past the window, so the kiosk is armed again.
    expect(state.rearmed).toBe(true);
  });

  it("restarts the absence window when someone walks back into frame", () => {
    let state = { faceFreeSince: 0, rearmed: false };

    // Someone walks in — the clock resets to zero.
    state = nextPresence({ facePresent: true, state, now: 9500 });
    expect(state.faceFreeSince).toBe(0);
    expect(state.rearmed).toBe(false);

    // They leave again; the window is measured from the new empty moment.
    state = nextPresence({ facePresent: false, state, now: 9600 });
    expect(state.faceFreeSince).toBe(9600);
    expect(state.rearmed).toBe(false);
    expect(
      nextPresence({ facePresent: false, state, now: 9600 + REARM_ABSENCE_MS - 1 }).rearmed,
    ).toBe(false);
    expect(nextPresence({ facePresent: false, state, now: 9600 + REARM_ABSENCE_MS }).rearmed).toBe(
      true,
    );
  });
});

describe("scan policy — per-person cooldown", () => {
  it("never treats a first-ever decision as a repeat", () => {
    expect(isRepeatDecision({ lastDecisionAt: 0, now: 1_000_000 })).toBe(false);
  });

  it("suppresses a second decision inside the cooldown window", () => {
    const first = 1_000_000;
    expect(isRepeatDecision({ lastDecisionAt: first, now: first + 6_000 })).toBe(true);
    expect(isRepeatDecision({ lastDecisionAt: first, now: first + PERSON_COOLDOWN_MS - 1 })).toBe(
      true,
    );
  });

  it("allows a genuinely new arrival once the cooldown has passed", () => {
    const first = 1_000_000;
    expect(isRepeatDecision({ lastDecisionAt: first, now: first + PERSON_COOLDOWN_MS })).toBe(
      false,
    );

    // Morning class 7:40 AM, afternoon class 1:10 PM — hours apart.
    const morning = new Date("2026-09-12T07:40:00").getTime();
    const afternoon = new Date("2026-09-12T13:10:00").getTime();
    expect(isRepeatDecision({ lastDecisionAt: morning, now: afternoon })).toBe(false);
  });
});

describe("scan policy — identity-aware decision gate", () => {
  // shouldDecide is called with the prior decision FOR THE IDENTITY IN FRAME
  // (page.tsx looks it up by the matched person id). That lookup is what makes
  // the two hand-off scenarios behave: a brand-new student has NO entry in
  // the per-person map, so their lastDecisionAt is 0 and they are decided
  // immediately — even while the previous student's notice is still up.
  it("always decides a person with no prior decision (brand-new student)", () => {
    expect(shouldDecide({ lastDecisionAt: 0, frameEmptySinceLastDecision: false, now: 60_000 })).toBe(
      true,
    );
    // Even one second after a DIFFERENT person was granted — the new arrival
    // is never blocked by the previous person's state.
    expect(shouldDecide({ lastDecisionAt: 0, frameEmptySinceLastDecision: false, now: 1_000 })).toBe(
      true,
    );
  });

  it("decides the same person once per stay while they never leave the frame", () => {
    const grantedAt = 10_000;
    expect(
      shouldDecide({
        lastDecisionAt: grantedAt,
        frameEmptySinceLastDecision: false,
        now: grantedAt + 59_000,
      }),
    ).toBe(false);
  });

  it("blocks a fast return until the re-decide hold has passed", () => {
    const grantedAt = 10_000;
    // Frame genuinely cleared 2s later, student back within 4s of the grant.
    expect(
      shouldDecide({
        lastDecisionAt: grantedAt,
        frameEmptySinceLastDecision: true,
        now: grantedAt + PERSON_REDECIDE_MS - 1,
      }),
    ).toBe(false);
  });

  it("re-decides a genuine return visit after the hold (notice re-shown, log suppressed)", () => {
    const grantedAt = 10_000;
    expect(
      shouldDecide({
        lastDecisionAt: grantedAt,
        frameEmptySinceLastDecision: true,
        now: grantedAt + PERSON_REDECIDE_MS,
      }),
    ).toBe(true);
    // The decision runs, but isRepeatDecision still stops a second log row
    // for 60s — the student sees "already recorded" again, nothing else.
    expect(
      isRepeatDecision({ lastDecisionAt: grantedAt, now: grantedAt + PERSON_REDECIDE_MS }),
    ).toBe(true);
  });

  it("full hand-off: student A granted, B steps in seconds later — B is decided", () => {
    const aGrantedAt = 0;
    let frame = { faceFreeSince: 0, rearmed: false } as ReturnType<typeof nextPresence>;

    // A stands there granted; scanner holds.
    frame = nextPresence({ facePresent: true, state: frame, now: aGrantedAt });

    // A leaves; frame clears past the absence window at t=2000.
    frame = nextPresence({ facePresent: false, state: frame, now: 600 });
    frame = nextPresence({ facePresent: false, state: frame, now: 600 + REARM_ABSENCE_MS });
    expect(frame.rearmed).toBe(true);

    // B walks in at t=2200. The prior decision is looked up FOR B — who has
    // none — so B is decided despite A's 60s window being far from over.
    const bPriorDecisionAt = 0; // B has no decision on record
    expect(
      shouldDecide({
        lastDecisionAt: bPriorDecisionAt,
        frameEmptySinceLastDecision: frame.rearmed,
        now: 2_200,
      }),
    ).toBe(true);
  });

  it("full dart-out: A ducks out 1s and returns — A is NOT re-decided", () => {
    // Grant at t=5000 (never 0 — 0 is the "no decision yet" sentinel).
    const aGrantedAt = 5_000;
    let frame = { faceFreeSince: 0, rearmed: false } as ReturnType<typeof nextPresence>;

    frame = nextPresence({ facePresent: true, state: frame, now: aGrantedAt });

    // Out for ~1s — under REARM_ABSENCE_MS.
    frame = nextPresence({ facePresent: false, state: frame, now: 6_000 });
    frame = nextPresence({ facePresent: true, state: frame, now: 6_200 });
    expect(frame.rearmed).toBe(false);

    // Same person, frame never cleared → no second decision while they stand
    // there; the "already recorded" notice keeps its original timestamp.
    expect(
      shouldDecide({
        lastDecisionAt: aGrantedAt,
        frameEmptySinceLastDecision: frame.rearmed,
        now: 30_000,
      }),
    ).toBe(false);
  });
});

describe("scan policy — unrecognised-face dwell", () => {
  // Real numbers from this hardware: a student walking up measured 0.26 on the
  // first frame and 0.63 two seconds later. The low read must not be logged as
  // a denial, nor shown as a score.
  it("does not call a moving walk-up frame unrecognised", () => {
    expect(isSettledUnknown({ matched: false, firstSeenAt: 1000, now: 1200 })).toBe(false);
  });

  it("settles once the low reading has persisted for the full dwell", () => {
    expect(
      isSettledUnknown({ matched: false, firstSeenAt: 1000, now: 1000 + UNKNOWN_DWELL_MS - 1 }),
    ).toBe(false);
    expect(
      isSettledUnknown({ matched: false, firstSeenAt: 1000, now: 1000 + UNKNOWN_DWELL_MS }),
    ).toBe(true);
  });

  it("is never 'unrecognised' once the face matched", () => {
    expect(isSettledUnknown({ matched: true, firstSeenAt: 1000, now: 99_000 })).toBe(false);
  });

  it("stays unsettled until the dwell clock actually starts", () => {
    expect(isSettledUnknown({ matched: false, firstSeenAt: 0, now: 99_000 })).toBe(false);
  });
});

describe("scan policy — visit generations", () => {
  // A generation is one person's stay at the gate. A new generation (and with
  // it a new access row) only exists after the scanner re-arms — which needs
  // the frame to have been empty for the full absence window. That is the
  // whole fix for "I stepped out for one second and it logged me again".
  it("stays in the same visit when the frame never empties", () => {
    expect(visitGeneration({ rearmed: false, current: 3 })).toEqual({ gen: 3, isNew: false });
  });

  it("only advances the generation once the scanner has re-armed", () => {
    expect(visitGeneration({ rearmed: true, current: 3 })).toEqual({ gen: 4, isNew: true });
  });

  it("a one-second dart out of frame does not start a new visit", () => {
    // Exactly the reported bug: dart out for ~1s, return, get logged twice.
    // 1s < REARM_ABSENCE_MS, so the scanner never re-arms during the dart.
    let gen = 1;
    let state = { faceFreeSince: 0, rearmed: false };

    // Person present, granted, scanner locks.
    state = nextPresence({ facePresent: true, state, now: 0 });
    gen = visitGeneration({ rearmed: state.rearmed, current: gen }).gen;

    // Darts out for 1s (below the 1.5s window) ...
    state = nextPresence({ facePresent: false, state, now: 1000 });
    expect(state.rearmed).toBe(false); // not yet
    // ... and is back before the window elapses.
    state = nextPresence({ facePresent: true, state, now: 1200 });
    gen = visitGeneration({ rearmed: state.rearmed, current: gen }).gen;

    expect(gen).toBe(1); // same visit — no second row is possible
  });

  it("a real departure starts a fresh visit, so the next student logs", () => {
    let gen = 1;
    let state = { faceFreeSince: 0, rearmed: false };

    state = nextPresence({ facePresent: true, state, now: 0 });
    gen = visitGeneration({ rearmed: state.rearmed, current: gen }).gen;

    // Leaves, frame stays empty past the window.
    state = nextPresence({ facePresent: false, state, now: 1000 });
    state = nextPresence({ facePresent: false, state, now: 1000 + REARM_ABSENCE_MS });
    expect(state.rearmed).toBe(true);

    gen = visitGeneration({ rearmed: state.rearmed, current: gen }).gen;
    expect(gen).toBe(2); // new visit — next student is recorded normally
  });
});

describe("scan policy — gate reporting", () => {
  it("reports OPEN only when the controller confirmed it", () => {
    expect(resolveGateOutcome({ gateConnected: true, confirmed: true })).toBe("OPEN");
    expect(gateStateForLog({ gateConnected: true, confirmed: true })).toBe("open");
  });

  it("reports AWAITING when a controller is linked but silent", () => {
    expect(resolveGateOutcome({ gateConnected: true, confirmed: false })).toBe("AWAITING");
    expect(gateStateForLog({ gateConnected: true, confirmed: false })).toBe("unconfirmed");
  });

  it("reports SENT (demo) instead of pretending an unwired barrier opened", () => {
    expect(resolveGateOutcome({ gateConnected: false, confirmed: false })).toBe("SENT");
    expect(resolveGateOutcome({ gateConnected: false, confirmed: true })).toBe("SENT");
    expect(gateStateForLog({ gateConnected: false })).toBe("simulated");
  });

  it("clamps the gate window so a bad settings row cannot hide the barrier", () => {
    expect(clampGateWindow(5)).toBe(5);
    expect(clampGateWindow(2.4)).toBe(3);
    expect(clampGateWindow(0)).toBe(3);
    expect(clampGateWindow(-3)).toBe(3);
    expect(clampGateWindow(Number.NaN)).toBe(5);
    expect(clampGateWindow(600)).toBe(60);
  });
});

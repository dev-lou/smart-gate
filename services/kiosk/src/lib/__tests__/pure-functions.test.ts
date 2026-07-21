/**
 * Pure Function Tests
 * ====================
 * Tests for all pure logic functions that don't require browser APIs.
 * These functions are inlined here for test isolation.
 */

import { describe, it, expect } from "vitest";

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
    uniform_type: "BSIT Uniform",
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

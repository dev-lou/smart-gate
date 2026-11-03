"use client";

/**
 * Camera QR decoding
 * ==================
 * jsQR over a downscaled crop of the current frame. The kiosk already draws the
 * camera frame into a canvas for face detection, so this reuses it: no second
 * camera stream, no extra permissions.
 *
 * Decoding is per OVAL, not per frame. Two students can hold a code up at the
 * same time \u2014 one over each oval \u2014 and a single full-frame decode would only
 * ever return one of them. Each oval reads its own half: left oval = left half,
 * right oval = right half, so a code belongs to the student standing there.
 *
 * Downscaling matters for throughput \u2014 a 1080p frame decoded at full size costs
 * tens of milliseconds per attempt, while 480px wide is enough for a code held
 * at arm's length and costs a fraction of that.
 */

import jsQR from "jsqr";
import { parseQrPayload } from "./qr";

const MAX_DECODE_WIDTH = 480;

let scratch: HTMLCanvasElement | null = null;

function scratchCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (!scratch) scratch = document.createElement("canvas");
  return scratch;
}

/**
 * Raw text of the first QR inside a horizontal slice of the frame.
 * `from`/`to` are fractions of the width (0-1).
 */
export function decodeQrTextInRegion(
  source: HTMLCanvasElement,
  from: number,
  to: number,
  maxWidth: number = MAX_DECODE_WIDTH,
): string | null {
  const canvas = scratchCanvas();
  if (!canvas || source.width === 0 || source.height === 0) return null;

  const fromX = Math.max(0, Math.min(1, from));
  const toX = Math.max(fromX, Math.min(1, to));
  const sliceWidth = Math.round(source.width * (toX - fromX));
  if (sliceWidth < 8) return null;

  const scale = Math.min(1, maxWidth / sliceWidth);
  const w = Math.max(1, Math.round(sliceWidth * scale));
  const h = Math.max(1, Math.round(source.height * scale));

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(
    source,
    Math.round(source.width * fromX),
    0,
    sliceWidth,
    source.height,
    0,
    0,
    w,
    h,
  );
  const image = ctx.getImageData(0, 0, w, h);
  const found = jsQR(image.data, w, h, { inversionAttempts: "dontInvert" });
  return found?.data ?? null;
}

/** Whole-frame decode (kept for callers that are not tied to an oval). */
export function decodeQrText(source: HTMLCanvasElement, maxWidth: number = MAX_DECODE_WIDTH): string | null {
  return decodeQrTextInRegion(source, 0, 1, maxWidth);
}

/** Student ID from a school-ID QR in a horizontal slice of the frame. */
export function decodeStudentQrInRegion(
  source: HTMLCanvasElement,
  from: number,
  to: number,
): string | null {
  const text = decodeQrTextInRegion(source, from, to);
  return text ? parseQrPayload(text) : null;
}

/** Student ID from a school-ID QR anywhere in the frame. */
export function decodeStudentQr(source: HTMLCanvasElement): string | null {
  const text = decodeQrText(source);
  return text ? parseQrPayload(text) : null;
}

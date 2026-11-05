"use client";

/**
 * Camera QR decoding
 * ==================
 * jsQR over a downscaled copy of the current frame. The kiosk already draws the
 * camera frame into a canvas for face detection, so this reuses it: no second
 * camera stream, no extra permissions.
 *
 * One oval means one region: with a single standing spot the whole frame is the
 * read area, so a code held up anywhere in view is found.
 *
 * Decoding is retried, because a phone screen held at arm's length in a lobby is
 * bad sensor input — dim, glossy, and often showing a dark-mode code (white
 * modules on black). Three passes, stopping at the first hit:
 *
 *   1. 480 px, normal polarity — the common case, and the cheapest.
 *   2. 480 px, inverted — catches a dark-mode code.
 *   3. 640 px, contrast stretched, both polarities — dim or glarey frames, where
 *      the crop's brightest and darkest points sit nowhere near white and black
 *      and jsQR's local threshold has nothing to bite on.
 *
 * Downscaling matters for throughput: a 1080p frame at full size costs tens of
 * milliseconds per attempt, while 480 px is enough for a code at arm's length.
 */

import jsQR from "jsqr";
import { parseQrPayload } from "./qr";

const FIRST_PASS_WIDTH = 480;
const LAST_PASS_WIDTH = 640;

let scratch: HTMLCanvasElement | null = null;

/** A decoder crash is reported once, then swallowed — never every frame. */
let warned = false;

function scratchCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (!scratch) scratch = document.createElement("canvas");
  return scratch;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * Stretch a crop's tonal range to full black-to-white, in place.
 *
 * Last pass only. A frame with under ~24 levels of range is flat — a covered
 * lens, a blank wall — and stretching that only invents edges that were never in
 * the image, so it is refused instead. Returns whether anything changed.
 */
export function stretchContrast(image: { data: Uint8ClampedArray }): boolean {
  const data = image.data;
  if (data.length < 4) return false;

  let low = 255;
  let high = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    if (luma < low) low = luma;
    if (luma > high) high = luma;
  }

  if (high - low < 24) return false;

  const scale = 255 / (high - low);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampByte((data[i] - low) * scale);
    data[i + 1] = clampByte((data[i + 1] - low) * scale);
    data[i + 2] = clampByte((data[i + 2] - low) * scale);
  }
  return true;
}

/**
 * Raw text of the first QR inside a horizontal slice of the frame.
 * `from`/`to` are fractions of the width (0-1); the default slice is the whole
 * frame, which is the only region the single-oval kiosk reads.
 */
export function decodeQrTextInRegion(source: HTMLCanvasElement, from = 0, to = 1): string | null {
  const canvas = scratchCanvas();
  if (!canvas || source.width === 0 || source.height === 0) return null;

  const fromX = Math.max(0, Math.min(1, from));
  const toX = Math.max(fromX, Math.min(1, to));
  const sliceWidth = Math.round(source.width * (toX - fromX));
  if (sliceWidth < 8) return null;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  /** Draw the slice into the scratch canvas at a width, and read it back. */
  const grab = (targetWidth: number): { image: ImageData; width: number; height: number } => {
    const scale = Math.min(1, targetWidth / sliceWidth);
    const width = Math.max(1, Math.round(sliceWidth * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(
      source,
      Math.round(source.width * fromX),
      0,
      sliceWidth,
      source.height,
      0,
      0,
      width,
      height,
    );
    return { image: ctx.getImageData(0, 0, width, height), width, height };
  };

  /**
   * jsQR must never take the camera HUD down with it. This runs inside the
   * recognition loop, so a thrown decode used to abort the frame before the
   * overlay was drawn — the ovals and the face reticle silently disappeared
   * while the video kept playing, which looked like the UI had broken.
   */
  const decode = (
    image: ImageData,
    width: number,
    height: number,
    mode: "dontInvert" | "onlyInvert" | "attemptBoth",
  ): string | null => {
    try {
      return jsQR(image.data, width, height, { inversionAttempts: mode })?.data || null;
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn("QR decode failed:", error);
      }
      return null;
    }
  };

  // 1 and 2 — one grab, both polarities.
  const first = grab(FIRST_PASS_WIDTH);
  const straight = decode(first.image, first.width, first.height, "dontInvert");
  if (straight) return straight;

  const inverted = decode(first.image, first.width, first.height, "onlyInvert");
  if (inverted) return inverted;

  // 3 — dim or glarey: more pixels, full tonal range, both polarities.
  const second = grab(LAST_PASS_WIDTH);
  if (!stretchContrast(second.image)) return null;
  return decode(second.image, second.width, second.height, "attemptBoth");
}

/** Whole-frame decode. */
export function decodeQrText(source: HTMLCanvasElement): string | null {
  return decodeQrTextInRegion(source, 0, 1);
}

/** Student ID from a school-ID QR in a horizontal slice of the frame. */
export function decodeStudentQrInRegion(
  source: HTMLCanvasElement,
  from = 0,
  to = 1,
): string | null {
  const text = decodeQrTextInRegion(source, from, to);
  return text ? parseQrPayload(text) : null;
}

/** Student ID from a school-ID QR anywhere in the frame. */
export function decodeStudentQr(source: HTMLCanvasElement): string | null {
  return decodeStudentQrInRegion(source, 0, 1);
}

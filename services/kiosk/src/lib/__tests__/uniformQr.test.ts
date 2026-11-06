import { describe, expect, it } from "vitest";

import { qrFallbackFaceBbox, torsoRegion } from "../uniform";

// The school-ID QR path has no detected face, but the uniform check still
// runs: the fallback box stands in for the head so torsoRegion() reads the
// same centre-bottom band the camera path reads.
describe("qrFallbackFaceBbox", () => {
  it("sits centred and head-high in frame ratios", () => {
    const [x, y, w, h] = qrFallbackFaceBbox();
    expect(x + w / 2).toBeCloseTo(0.5, 5);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y + h).toBeLessThan(0.5);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it("derives a torso band below the chin that reaches the frame bottom", () => {
    const vw = 640;
    const vh = 480;
    const band = torsoRegion(qrFallbackFaceBbox(), {
      videoWidth: vw,
      videoHeight: vh,
    });
    const chinY = (0.12 + 0.3) * vh;
    expect(band.y).toBeGreaterThanOrEqual(chinY * 0.8);
    expect(band.y + band.height).toBeCloseTo(vh, 0);
    expect(band.width).toBeGreaterThan(vw * 0.5);
    expect(band.x + band.width / 2).toBeCloseTo(vw / 2, 0);
  });
});

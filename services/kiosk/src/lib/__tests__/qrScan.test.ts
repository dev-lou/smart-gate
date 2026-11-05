import { describe, expect, it } from "vitest";
import { stretchContrast } from "../qrScan";

/** Grey image built from luma values, alpha fixed at 255. */
function greyImage(values: readonly number[]): { data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  });
  return { data };
}

describe("stretchContrast", () => {
  it("spreads a dim, narrow-range frame across black to white", () => {
    const image = greyImage([100, 120, 140]);
    expect(stretchContrast(image)).toBe(true);
    expect(image.data[0]).toBe(0);
    expect(image.data[4]).toBe(128);
    expect(image.data[8]).toBe(255);
  });

  it("leaves alpha alone", () => {
    const image = greyImage([90, 150]);
    stretchContrast(image);
    expect(image.data[3]).toBe(255);
    expect(image.data[7]).toBe(255);
  });

  it("refuses a flat frame instead of inventing edges", () => {
    const image = greyImage([120, 120, 130]);
    expect(stretchContrast(image)).toBe(false);
    expect(image.data[0]).toBe(120);
  });
});

import { describe, expect, it } from "vitest";
import { proteinFromText } from "../src/lib/nutrition";

describe("proteinFromText", () => {
  it("takes the value for the whole product when it is plausible", () => {
    expect(proteinFromText("Burger. Valoare energetică: 540 kcal; proteine: 28 g; lipide: 30 g", 240)).toBe(28);
  });

  it("scales a per-100 g table to the product", () => {
    // 160 kcal for a 725 g menu is a per-100 g value.
    expect(proteinFromText("Gyros 605g + pita 120g. Valoare energetică: 160 kcal / 670 kj; proteine: 5.01 g", 725)).toBeCloseTo(36.3, 1);
  });

  it("gives nothing when there is no protein line or the numbers make no sense", () => {
    expect(proteinFromText("Burger cu carne de vită", 240)).toBeNull();
    expect(proteinFromText("Sos. proteine: 40 g, 10 kcal", 25)).toBeNull();
  });
});

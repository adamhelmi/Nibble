// tests/mathEngine.test.ts
import {
  convert, normalizeUnit, scaleRecipe, totalCost, costBreakdown, type Ingredient
} from "../lib/mathEngine";

describe("normalizeUnit", () => {
  test("maps synonyms", () => {
    expect(normalizeUnit("grams")).toBe("g");
    expect(normalizeUnit("Kilograms")).toBe("kg");
    expect(normalizeUnit("tablespoons")).toBe("tbsp");
    expect(normalizeUnit("teaspoons")).toBe("tsp");
    expect(normalizeUnit("cups")).toBe("cup");
    expect(normalizeUnit("each")).toBe("unit");
  });
});

describe("convert (mass)", () => {
  test("kg ↔ g", () => {
    expect(convert(1, "kg", "g")).toBe(1000);
    expect(convert(250, "g", "kg")).toBe(0.25);
  });
});

describe("convert (volume)", () => {
  test("l ↔ ml", () => {
    expect(convert(1, "l", "ml")).toBe(1000);
    expect(convert(500, "ml", "l")).toBe(0.5);
  });
  test("tbsp/tsp/cup ↔ ml", () => {
    expect(convert(2, "tbsp", "ml")).toBe(30);
    expect(convert(3, "tsp", "ml")).toBe(15);
    expect(convert(1, "cup", "ml")).toBe(240);
    expect(convert(240, "ml", "cup")).toBe(1);
  });
});

describe("convert (count)", () => {
  test("unit ↔ unit", () => {
    expect(convert(3, "unit", "unit")).toBe(3);
  });
});

describe("convert (incompatible)", () => {
  test("throws across dimensions", () => {
    expect(() => convert(1, "g", "ml")).toThrow();
    expect(() => convert(1, "ml", "unit")).toThrow();
  });
});

describe("scaleRecipe", () => {
  test("scales quantities deterministically", () => {
    const ing: Ingredient[] = [
      { name: "milk", qty: 250, unit: "ml" },
      { name: "flour", qty: 200, unit: "g" },
    ];
    const scaled = scaleRecipe(2, ing);
    expect(scaled[0].qty).toBe(500);
    expect(scaled[1].qty).toBe(400);
  });
});

describe("totalCost + costBreakdown", () => {
  const priceBook = {
    milk:  { unit: "ml", amount: 0.00125 }, // $0.00125 / ml ($1.25/L)
    flour: { unit: "g",  amount: 0.002 },   // $0.002 / g  ($2.00/kg)
    egg:   { unit: "unit", amount: 0.25 },  // $0.25 per egg
  } as any;

  test("computes cost with unit conversions", () => {
    const ing: Ingredient[] = [
      { name: "Milk", qty: 500, unit: "ml" },  // $0.625
      { name: "Flour", qty: 300, unit: "g" },  // $0.600
      { name: "Egg", qty: 2, unit: "unit" },   // $0.500
    ];
    const cost = totalCost(ing, priceBook);
    expect(cost).toBe(1.73); // 0.625 + 0.6 + 0.5 = 1.725 → 1.73
  });

  test("breakdown includes per-line costs", () => {
    const ing: Ingredient[] = [
      { name: "Milk", qty: 240, unit: "ml" },  // $0.30
      { name: "Spinach", qty: 100, unit: "g" } // missing
    ];
    const rows = costBreakdown(ing, priceBook);
    expect(rows[0].cost).toBe(0.30);
    expect(rows[1].cost).toBeUndefined();
  });
});

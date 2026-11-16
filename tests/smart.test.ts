import { describe, expect, it } from "vitest";
import { parseNutrition } from "../src/lib/nutrition";
import { DEFAULT_WEIGHTS, categoriesOf, recommend } from "../src/lib/smart";
import type { FeeRules, MenuItem, OptimizeOptions, Preferences } from "../src/lib/types";

const item = (name: string, price: number, grams: number, extra: Partial<MenuItem> = {}): MenuItem => ({
  id: name,
  name,
  description: "",
  category: "",
  price,
  grams,
  kind: "food",
  ...extra,
});
const fries = (price = 700, grams = 120) => item("Cartofi prajiti", price, grams, { kind: "side" });
const cola = (price = 600) => item("Cola 330ml", price, 330, { kind: "drink" });
const noFees: FeeRules = { deliveryFee: 0, minOrder: 0, notes: [] };
const opts = (budget: number, preferences: Preferences = {}, o: Partial<OptimizeOptions> = {}): OptimizeOptions => ({
  budget,
  scope: "total",
  mode: "hard",
  tolerancePct: 10,
  maxPerItem: 3,
  includeDrinks: false,
  includeSauces: false,
  sides: "balanced",
  preferences,
  ...o,
});
const names = (r: ReturnType<typeof recommend>, i = 0) => r.suggestions[i].basket.lines.map((l) => l.name);

const menu = [
  item("Burger Clasic", 2500, 250),
  item("Burger Dublu", 3500, 380),
  item("Pui Crispy", 2800, 260),
  fries(),
  cola(),
  item("Apa plata 500ml", 400, 500, { kind: "drink" }),
];

describe("recommend: constraints", () => {
  it("never exceeds the budget, fees included", () => {
    const fees: FeeRules = { deliveryFee: 700, minOrder: 0, notes: [] };
    for (const budget of [3500, 5000, 8000, 12000]) {
      const r = recommend(menu, fees, [], opts(budget));
      for (const s of r.suggestions) expect(s.basket.cost.counted).toBeLessThanOrEqual(budget);
    }
  });

  it("puts mandatory products in every suggestion, or says why not", () => {
    const r = recommend(menu, noFees, [], opts(6000, { must: ["Pui Crispy"] }));
    for (const s of r.suggestions) expect(s.basket.lines.map((l) => l.name)).toContain("Pui Crispy");
    const missing = recommend(menu, noFees, [], opts(6000, { must: ["Sushi"] }));
    expect(missing.unmet.join(" ")).toContain("Sushi");
    expect(missing.suggestions.length).toBeGreaterThan(0);
  });

  it("reports an impossible mandatory product instead of overspending", () => {
    const r = recommend(menu, noFees, [], opts(2000, { must: ["Burger Dublu"] }));
    expect(r.suggestions).toHaveLength(0);
    expect(r.reason).toMatch(/obligatorii/);
  });

  it("avoided products (excludeNames) never appear", () => {
    const r = recommend(menu, noFees, [], opts(6000, {}, { excludeNames: ["Burger Clasic"] }));
    for (const s of r.suggestions) expect(s.basket.lines.map((l) => l.name)).not.toContain("Burger Clasic");
  });

  it("respects the per-item cap and one side per main", () => {
    const r = recommend([item("Burger", 2000, 250), fries(300, 200)], noFees, [], opts(10000, {}, { maxPerItem: 2 }));
    const lines = r.suggestions[0].basket.lines;
    expect(Math.max(...lines.map((l) => l.qty))).toBeLessThanOrEqual(2);
    const sides = lines.filter((l) => l.kind === "side").reduce((a, l) => a + l.qty, 0);
    const mains = lines.filter((l) => l.kind === "food").reduce((a, l) => a + l.qty, 0);
    expect(sides).toBeLessThanOrEqual(mains);
  });
});

describe("recommend: preferences are soft", () => {
  it("a preferred drink joins when affordable, but is not forced when it is not", () => {
    const base = recommend(menu, noFees, [], opts(5500));
    expect(names(base)).not.toContain("Cola 330ml");
    const wish = recommend(menu, noFees, [], opts(5500, { prefer: ["Cola 330ml"] }));
    expect(names(wish)).toContain("Cola 330ml");
    const tight = recommend(menu, noFees, [], opts(2600, { prefer: ["Cola 330ml"] }));
    expect(names(tight)).not.toContain("Cola 330ml");
    expect(tight.suggestions.length).toBeGreaterThan(0);
  });

  it("a preferred category is covered when affordable", () => {
    const r = recommend(menu, noFees, [], opts(6000, { preferCategories: ["drink", "fries"] }));
    const kinds = new Set(r.suggestions[0].basket.lines.map((l) => l.kind));
    expect(kinds.has("drink")).toBe(true);
    expect(kinds.has("side")).toBe(true);
  });

  it("sides are not excluded: they are chosen when they are the best value", () => {
    const r = recommend([item("Burger", 2500, 250), fries(200, 400)], noFees, [], opts(5000));
    expect(names(r)).toContain("Cartofi prajiti");
  });
});

describe("recommend: menus (combos)", () => {
  const combo = item("Meniu Burger Clasic", 3500, 370, { includes: { fries: true, drink: true } });
  const withCombo = [...menu, combo];

  it("takes the combo instead of the same parts one by one when it is cheaper", () => {
    const r = recommend(withCombo, noFees, [], opts(4000, { mustCategories: ["fries", "drink"] }));
    expect(names(r)).toEqual(["Meniu Burger Clasic"]);
    // 25 + 7 + 4 (cheapest drink: water is not a soft drink, so cola 6) vs 35
    expect(r.suggestions[0].deals[0].saves).toBeGreaterThan(0);
  });

  it("covers categories through the combo's includes", () => {
    expect([...categoriesOf(combo)].sort()).toEqual(["burger", "drink", "fries"]);
  });
});

describe("recommend: variety and weights", () => {
  const twins = [item("Burger A", 2000, 300), item("Burger B", 2000, 290), item("Pui Crispy", 2100, 270)];
  it("prefers a different product over a near-identical one when variety weighs", () => {
    const r = recommend(twins, noFees, [], opts(6200, { weights: { variety: 0.9 } }));
    expect(r.suggestions[0].basket.lines.some((l) => l.name === "Pui Crispy")).toBe(true);
  });

  it("weights are configurable: savings makes the basket cheaper", () => {
    const rich = recommend(menu, noFees, [], opts(9000));
    const thrifty = recommend(menu, noFees, [], opts(9000, { weights: { savings: 3 } }));
    expect(thrifty.suggestions[0].basket.cost.counted).toBeLessThan(rich.suggestions[0].basket.cost.counted);
  });

  it("alternatives differ from the main basket and show their trade-offs", () => {
    const r = recommend(menu, noFees, [], opts(9000));
    const sigs = new Set(r.suggestions.map((s) => s.basket.lines.map((l) => `${l.name}x${l.qty}`).sort().join("|")));
    expect(sigs.size).toBe(r.suggestions.length);
    for (const s of r.suggestions.slice(1)) expect(s.tradeoffs.length).toBeGreaterThan(0);
  });

  it("default weights are all non-negative", () => {
    for (const v of Object.values(DEFAULT_WEIGHTS)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("nutrition is read, never invented", () => {
  it("reads per-100 g values and scales them to the product", () => {
    const n = parseNutrition("Falafel (200g). Valoare energetică: 600Kj/150KCal, Proteine: 6g (per 100g)", 200);
    expect(n).toEqual({ kcal: 300, protein: 12 });
  });
  it("is null without a nutrition line or with an ambiguous basis", () => {
    expect(parseNutrition("Burger cu pui si sos", 250)).toEqual({ kcal: null, protein: null });
    expect(parseNutrition("Burger 250g, 450 kcal", 250)).toEqual({ kcal: null, protein: null });
  });
  it("is null when the text covers several products", () => {
    expect(parseNutrition("Taco 150g 218 kcal; Burrito 400g 227 kcal (per 100g)", 150)).toEqual({ kcal: null, protein: null });
  });
  it("does not read 'proteine din soia' as a nutrient", () => {
    expect(parseNutrition("Ingrediente: făină, proteine din soia, sare", 200).protein).toBeNull();
  });
  it("has no calorie totals when the menu has none", () => {
    const r = recommend(menu, noFees, [], opts(6000));
    expect(r.suggestions[0].kcal).toBeNull();
  });
  it("totals count only what the menu states", () => {
    const d = (k: number, p: number) => `Valoare energetică: ${k} kcal, Proteine: ${p} g (per 100g)`;
    const list = [
      item("Burger Clasic", 2500, 250, { description: d(200, 10) }),
      item("Pui Crispy", 2800, 260, { description: d(220, 14) }),
      item("Burger Dublu", 3500, 380, { description: d(210, 12) }),
      fries(),
    ];
    const s = recommend(list, noFees, [], opts(9000)).suggestions[0];
    expect(s.kcal).not.toBeNull();
    expect(s.kcal!.knownUnits).toBeLessThanOrEqual(s.kcal!.units);
  });
});

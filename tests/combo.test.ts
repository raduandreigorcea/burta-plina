import { describe, expect, it } from "vitest";
import { optimize } from "../src/lib/optimizer";
import type { FeeRules, MenuItem, OptimizeOptions } from "../src/lib/types";
import { comboIncludes, isFries } from "../src/lib/weight";

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

const noFees: FeeRules = { deliveryFee: 0, minOrder: 0, notes: [] };
const opts = (o: Partial<OptimizeOptions> = {}): OptimizeOptions => ({
  budget: 5000,
  scope: "total",
  mode: "hard",
  tolerancePct: 10,
  maxPerItem: 3,
  includeDrinks: false,
  includeSauces: false,
  ...o,
});
const names = (r: ReturnType<typeof optimize>) => r.best!.lines.map((l) => `${l.qty} ${l.name}`);

const burger = item("Burger", 2000, 200);
const fries = item("Cartofi prăjiți porție mare", 1200, 120, { kind: "side" });
const cola = item("Coca-Cola 0,5L", 1000, 500, { kind: "drink" });

describe("comboIncludes / isFries", () => {
  it("reads what a combo brings from its description", () => {
    expect(
      comboIncludes("Meniu Twister® Picant", "Twister® Picant 180g, 1 porție mare de cartofi prăjiți 120g, 1 băutură răcoritoare 0,5L."),
    ).toEqual({ fries: true, drink: true });
    expect(comboIncludes("Hot Bucket", "20 Hot Wings® 500g.")).toBeUndefined();
    expect(comboIncludes("8 Crispy Strips®", "8 bucăți picante din piept de pui 240g, 1 sos la alegere 54g/25g.")).toEqual({ sauce: true });
    expect(comboIncludes("6 Chicken McNuggets®, bucăţi de pui, 107 gr + 1 sos", "")).toEqual({ sauce: true });
    expect(comboIncludes("Twister®", "2 Strips, roșii, salată Iceberg, sos burger, tortilla - 180g.")).toBeUndefined();
    expect(comboIncludes("So Good Bucket", "10 Fillet Bites® 170g, 2 porții medii de cartofi prăjiți 2x90g.")).toEqual({ fries: true });
  });
  it("does not treat a wrap with fries inside as a combo", () => {
    expect(comboIncludes("Cheezy Twister Picant", "Crispy Strips, sos cald cu branza, cartofi prajiti, tortilla (240g)")).toBeUndefined();
  });
  it("recognises plain fries", () => {
    expect(isFries("Cartofi prăjiţi porţie mare, 150 gr")).toBe(true);
    expect(isFries("REALLY CRUNCHY FRIES")).toBe(true);
    expect(isFries("Chili Cheese Nuggets")).toBe(false);
  });
});

describe("fries and drink on request", () => {
  it("picks the combo when it is cheaper than the parts", () => {
    // Parts: 20 + 12 + 10 = 42 lei. Combo: 35 lei for the same food.
    const combo = item("Meniu Burger", 3500, 320, { includes: { fries: true, drink: true } });
    const r = optimize([burger, fries, cola, combo], noFees, [], opts({ budget: 4500, wantFries: true, includeDrinks: true }));
    expect(names(r)).toEqual(["1 Meniu Burger"]);
    expect(r.best!.cost.total).toBe(3500);
    expect(r.best!.lines[0].includes).toEqual({ fries: true, drink: true });
  });

  it("buys the parts when the combo is the worse deal", () => {
    const combo = item("Meniu Burger", 4400, 320, { includes: { fries: true, drink: true } });
    const r = optimize([burger, fries, cola, combo], noFees, [], opts({ budget: 4500, wantFries: true, includeDrinks: true }));
    expect(names(r)).toEqual(["1 Burger", "1 Cartofi prăjiți porție mare", "1 Coca-Cola 0,5L"]);
    expect(r.best!.grams).toBe(320);
  });

  it("spends what is left on more food next to the combo", () => {
    const combo = item("Meniu Burger", 3500, 320, { includes: { fries: true, drink: true } });
    const r = optimize([burger, fries, cola, combo], noFees, [], opts({ budget: 5500, wantFries: true, includeDrinks: true }));
    expect(names(r)).toEqual(["1 Meniu Burger", "1 Burger"]);
  });

  it("with only a drink wanted, a combo with a drink counts too", () => {
    const combo = item("Meniu Burger", 2500, 200, { includes: { drink: true } });
    const r = optimize([burger, cola, combo], noFees, [], opts({ budget: 3000, includeDrinks: true }));
    expect(names(r)).toEqual(["1 Meniu Burger"]);
  });

  it("always includes fries when asked, even if a second burger weighs more", () => {
    const r = optimize([burger, fries], noFees, [], opts({ budget: 4000, wantFries: true }));
    expect(names(r)).toEqual(["1 Burger", "1 Cartofi prăjiți porție mare"]);
    const without = optimize([burger, fries], noFees, [], opts({ budget: 4000 }));
    expect(names(without)).toEqual(["2 Burger"]);
  });

  it("requested fries still come with sides switched off, and never alone", () => {
    const r = optimize([burger, fries], noFees, [], opts({ budget: 4000, wantFries: true, sides: "none" }));
    expect(names(r)).toEqual(["1 Burger", "1 Cartofi prăjiți porție mare"]);
    const tooPoor = optimize([burger, fries], noFees, [], opts({ budget: 1500, wantFries: true }));
    expect(tooPoor.best).toBeNull();
  });

  it("adds one sauce when asked: the cheapest, or the one that comes with a product", () => {
    const ketchup = item("Sos Ketchup", 500, 50, { kind: "sauce" });
    const mayo = item("Sos Maioneză", 600, 25, { kind: "sauce" });
    const r = optimize([burger, ketchup, mayo], noFees, [], opts({ budget: 5000, includeSauces: true }));
    expect(names(r)).toEqual(["2 Burger", "1 Sos Ketchup"]);
    // The sauce is paid for but is not food.
    expect(r.best!.grams).toBe(400);
    expect(r.best!.cost.total).toBe(4500);
    const none = optimize([burger, ketchup, mayo], noFees, [], opts({ budget: 5000 }));
    expect(names(none)).toEqual(["2 Burger"]);

    const nuggets = item("9 McNuggets + 2 sosuri", 2400, 230, { includes: { sauce: true } });
    const withIncluded = optimize([burger, ketchup, nuggets], noFees, [], opts({ budget: 2400, includeSauces: true }));
    expect(names(withIncluded)).toEqual(["1 9 McNuggets + 2 sosuri"]);
  });

  it("fries, drink and sauce together: combo plus the missing sauce", () => {
    const combo = item("Meniu Burger", 3500, 320, { includes: { fries: true, drink: true } });
    const ketchup = item("Sos Ketchup", 500, 50, { kind: "sauce" });
    const r = optimize([burger, fries, cola, combo, ketchup], noFees, [], opts({
      budget: 4500, wantFries: true, includeDrinks: true, includeSauces: true,
    }));
    expect(names(r)).toEqual(["1 Meniu Burger", "1 Sos Ketchup"]);
  });

  it("does not add a second side on the credit the requested fries already used", () => {
    const corn = item("Nuggets", 300, 100, { kind: "side" });
    const r = optimize([burger, fries, corn], noFees, [], opts({ budget: 3600, wantFries: true }));
    // One burger allows one side, and that side is the fries asked for.
    expect(names(r)).toEqual(["1 Burger", "1 Cartofi prăjiți porție mare"]);
  });
});

describe("per-item cap and extras", () => {
  const combo = item("Meniu Mare", 2000, 600, { includes: { fries: true, drink: true } });
  const salad = item("Salată", 1000, 300, { kind: "other" });
  const bun = item("Chiflă", 300, 80, { kind: "other" });

  it("counts the product that fulfils a wish towards the per-item cap", () => {
    for (const maxPerItem of [1, 2, 3]) {
      const r = optimize([combo, burger, cola], noFees, [], opts({ budget: 10000, includeDrinks: true, maxPerItem }));
      expect(Math.max(...r.best!.lines.map((l) => l.qty))).toBeLessThanOrEqual(maxPerItem);
      expect(r.best!.lines.find((l) => l.name === "Meniu Mare")!.qty).toBe(maxPerItem);
    }
  });

  it("limits salads to one per main dish whether or not fries are wanted", () => {
    const menu = [burger, salad, bun, fries];
    const extras = (r: ReturnType<typeof optimize>) =>
      r.best!.lines.filter((l) => l.kind !== "food").reduce((a, l) => a + l.qty, 0);
    const mains = (r: ReturnType<typeof optimize>) =>
      r.best!.lines.filter((l) => l.kind === "food").reduce((a, l) => a + l.qty, 0);
    const off = optimize(menu, noFees, [], opts({ budget: 6000, includeOther: true, sides: "none" }));
    const on = optimize(menu, noFees, [], opts({ budget: 6000, includeOther: true, wantFries: true }));
    expect(extras(off)).toBeLessThanOrEqual(mains(off));
    expect(extras(on)).toBeLessThanOrEqual(mains(on));
    expect(off.best!.lines.some((l) => l.kind === "side")).toBe(false);
  });

  it("never returns a basket made only of salads", () => {
    const r = optimize([salad, bun], noFees, [], opts({ includeOther: true, sides: "none" }));
    expect(r.best).toBeNull();
    expect(r.reason).toMatch(/fel principal/);
  });
});

describe("salad and dessert wishes", () => {
  const caesar = item("Salată Caesar", 2200, 250, { kind: "salad" });
  const coleslaw = item("Salată Coleslaw", 900, 150, { kind: "salad" });
  const tiny = item("Salată mică", 1000, 100, { kind: "salad" });
  const pie = item("Plăcintă cu mere", 700, 80, { kind: "dessert" });
  const bun = item("Chiflă", 300, 80, { kind: "other" });
  const menu = [burger, caesar, coleslaw, tiny, pie, bun, fries];
  const count = (r: ReturnType<typeof optimize>, kind: string) =>
    r.best!.lines.filter((l) => l.kind === kind).reduce((a, l) => a + l.qty, 0);

  it("leaves salads and desserts out unless asked", () => {
    const r = optimize(menu, noFees, [], opts({ budget: 6000, sides: "none" }));
    expect(names(r)).toEqual(["3 Burger"]);
  });

  it("adds exactly one salad and one dessert when asked, and counts their grams", () => {
    const r = optimize(menu, noFees, [], opts({ budget: 6000, sides: "none", wantSalad: true, wantDessert: true }));
    expect(count(r, "salad")).toBe(1);
    expect(count(r, "dessert")).toBe(1);
    expect(count(r, "other")).toBe(0);
    // 2 burgers (400 g) + coleslaw (150 g) + pie (80 g) for 56 lei.
    expect(names(r)).toEqual(["2 Burger", "1 Salată Coleslaw", "1 Plăcintă cu mere"]);
    expect(r.best!.grams).toBe(630);
  });

  it("takes the bigger salad when the budget allows it", () => {
    const r = optimize([burger, caesar, coleslaw, tiny], noFees, [], opts({ budget: 4200, sides: "none", wantSalad: true }));
    expect(names(r)).toEqual(["1 Burger", "1 Salată Caesar"]);
  });

  it("never returns a salad or a dessert without a main dish", () => {
    const r = optimize(menu, noFees, [], opts({ budget: 1900, sides: "none", wantSalad: true, wantDessert: true }));
    expect(r.best).toBeNull();
  });

  it("ignores the wish when the restaurant has no salad", () => {
    const r = optimize([burger, pie], noFees, [], opts({ budget: 4500, sides: "none", wantSalad: true }));
    expect(names(r)).toEqual(["2 Burger"]);
  });
});

describe("fries are a side, never the meal", () => {
  const loaded = item("Loaded Chicken Fries BBQ", 2550, 260, { kind: "side" });
  const medium = item("Cartofi prăjiți porție medie", 1170, 90, { kind: "side" });
  const cappy = item("Cappy 0,33L", 1000, 330, { kind: "drink" });
  const sandwich = item("Sandviș", 1900, 170);

  it("wanting fries gives a main dish with one portion of fries, not two kinds of fries", () => {
    const r = optimize([loaded, medium, cappy, sandwich], noFees, [], opts({ budget: 4720, wantFries: true, includeDrinks: true }));
    expect(names(r)).toEqual(["1 Sandviș", "1 Cartofi prăjiți porție medie", "1 Cappy 0,33L"]);
  });

  it("a combo with fries does not get a second portion on top", () => {
    const combo = item("Meniu Sandviș", 2800, 260, { includes: { fries: true } });
    const r = optimize([combo, medium], noFees, [], opts({ budget: 4000, wantFries: true }));
    expect(names(r)).toEqual(["1 Meniu Sandviș"]);
  });
});

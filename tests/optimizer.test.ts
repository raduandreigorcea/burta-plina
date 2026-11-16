import { describe, expect, it } from "vitest";
import { computeCost, optimize } from "../src/lib/optimizer";
import type { FeeRules, MenuItem, OptimizeOptions } from "../src/lib/types";

const item = (id: string, price: number, grams: number | null, extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  name: id,
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

describe("optimize", () => {
  it("picks the max-grams combination, not the greedy one", () => {
    // Budget 50: greedy by g/leu takes A (30 lei, 400g) then nothing else fits
    // well; optimal is B+C = 50 lei, 600g.
    const items = [item("A", 3000, 400), item("B", 2500, 300), item("C", 2500, 300)];
    const r = optimize(items, noFees, [], opts({ maxPerItem: 1 }));
    expect(r.best?.grams).toBe(600);
    expect(r.best?.cost.total).toBe(5000);
  });

  it("respects the per-item cap", () => {
    const items = [item("fries", 500, 200), item("burger", 2000, 250)];
    const r = optimize(items, noFees, [], opts({ maxPerItem: 3 }));
    // Without a cap: 10 fries = 2000g. With cap 3 the best is
    // 2 burgers (40 lei, 500g) + 2 fries (10 lei, 400g) = 900g.
    expect(r.best!.grams).toBe(900);
    expect(Math.max(...r.best!.lines.map((l) => l.qty))).toBeLessThanOrEqual(3);
    const friesOnly = optimize([items[0]], noFees, [], opts({ maxPerItem: 3 }));
    expect(friesOnly.best!.lines[0].qty).toBe(3);
  });

  it("never exceeds a hard cap including fees", () => {
    const fees: FeeRules = { deliveryFee: 700, minOrder: 0, serviceFee: { flat: 199 }, notes: [] };
    const items = [item("a", 1000, 100), item("b", 1700, 190)];
    const r = optimize(items, fees, [], opts());
    expect(r.best!.cost.total).toBeLessThanOrEqual(5000);
    // 4101 left for food: a,a,b (3700, 390g) vs b,b (3400, 380g) vs a*3 (300g) vs a,a,a,+? (cap 3)
    expect(r.best!.grams).toBe(390);
  });

  it("food-only scope ignores fees for the budget but reports them", () => {
    const fees: FeeRules = { deliveryFee: 700, minOrder: 0, notes: [] };
    const r = optimize([item("a", 1000, 100)], fees, [], opts({ scope: "food", maxPerItem: 5 }));
    expect(r.best!.cost.subtotal).toBe(5000);
    expect(r.best!.cost.total).toBe(5700);
    expect(r.best!.cost.counted).toBe(5000);
  });

  it("uses the free-delivery threshold when it pays off", () => {
    const fees: FeeRules = { deliveryFee: 1000, freeDeliveryOver: 4500, minOrder: 0, notes: [] };
    // With delivery: 40 lei of food -> 4 items. Reaching 45 -> free delivery -> 5 items for 50.
    const r = optimize([item("a", 1000, 100)], fees, [], opts({ maxPerItem: 10 }));
    expect(r.best!.grams).toBe(500);
    expect(r.best!.cost.deliveryFee).toBe(0);
  });

  it("applies small-order surcharge (difference mode)", () => {
    const fees: FeeRules = {
      deliveryFee: 0,
      minOrder: 0,
      smallOrder: { threshold: 4000, mode: "difference" },
      notes: [],
    };
    expect(computeCost(2500, fees, [], "total").total).toBe(4000);
    expect(computeCost(4500, fees, [], "total").total).toBe(4500);
  });

  it("rejects when min order exceeds the budget", () => {
    const fees: FeeRules = { deliveryFee: 0, minOrder: 6000, notes: [] };
    const r = optimize([item("a", 1000, 100)], fees, [], opts({ maxPerItem: 10 }));
    expect(r.best).toBeNull();
    expect(r.reason).toMatch(/minimă/);
  });

  it("percent cart offer lets the subtotal exceed the budget", () => {
    const offers = [{ kind: "percent" as const, label: "-20%", pct: 20, minSubtotal: 0 }];
    const r = optimize([item("a", 1000, 100)], noFees, offers, opts({ maxPerItem: 10 }));
    // 6 items = 60 lei - 20% = 48 lei
    expect(r.best!.grams).toBe(600);
    expect(r.best!.cost.total).toBe(4800);
  });

  it("1+1 items count double grams for one price", () => {
    const items = [item("bogo", 2000, 200, { unitsPerPurchase: 2 }), item("plain", 2000, 300)];
    const r = optimize(items, noFees, [], opts({ maxPerItem: 2, budget: 4000 }));
    expect(r.best!.grams).toBe(800);
    expect(r.best!.lines[0].units).toBe(4);
  });

  it("flex mode offers a stretch basket only when it adds food", () => {
    const items = [item("a", 2600, 300)];
    const hard = optimize(items, noFees, [], opts());
    expect(hard.best!.grams).toBe(300);
    expect(hard.stretch).toBeNull();
    const flex = optimize(items, noFees, [], opts({ mode: "flex", tolerancePct: 10 }));
    expect(flex.best!.grams).toBe(300);
    expect(flex.stretch!.grams).toBe(600);
    expect(flex.stretch!.cost.total).toBe(5200);
  });

  it("skips guessed weights unless asked, but keeps borrowed ones", () => {
    const items = [
      item("guess", 1000, 900, { weightUncertain: true, weightSource: "description" }),
      item("borrowed", 1000, 300, { weightUncertain: true, weightSource: "other-platform" }),
      item("sure", 1000, 200, { weightSource: "name" }),
    ];
    const r = optimize(items, noFees, [], opts({ budget: 1000, maxPerItem: 1 }));
    expect(r.best!.lines[0].itemId).toBe("borrowed");
    const g = optimize(items, noFees, [], opts({ budget: 1000, maxPerItem: 1, includeGuessed: true }));
    expect(g.best!.lines[0].itemId).toBe("guess");
  });

  it("leaves out products the user excluded, ignoring case and diacritics", () => {
    const items = [item("Salată Coleslaw", 500, 400), item("Burger", 2000, 200)];
    const r = optimize(items, noFees, [], opts({ budget: 2000, excludeNames: ["salata coleslaw"] }));
    expect(r.best!.lines.map((l) => l.itemId)).toEqual(["Burger"]);
  });

  describe("sides", () => {
    const side = (id: string, price: number, grams: number) => item(id, price, grams, { kind: "side" });
    // Corn is by far the cheapest per gram; the burger is the actual meal.
    const menu = [side("porumb", 600, 90), side("chifla", 400, 50), item("burger", 2000, 200)];

    it("allows at most one side per main dish by default", () => {
      const r = optimize(menu, noFees, [], opts({ budget: 6000 }));
      const qty = (kind: string) => r.best!.lines.filter((l) => l.kind === kind).reduce((a, l) => a + l.qty, 0);
      expect(qty("side")).toBeLessThanOrEqual(qty("food"));
      // 2 burgers (40 lei, 400 g) + 2 corn (12 lei, 180 g) beats 3 burgers (600 g) on grams? No: 580 < 600.
      expect(r.best!.grams).toBe(600);
      const r2 = optimize(menu, noFees, [], opts({ budget: 5200 }));
      expect(r2.best!.lines.map((l) => `${l.qty} ${l.itemId}`)).toEqual(["2 burger", "2 porumb"]);
    });

    it("never returns a basket made only of sides", () => {
      const r = optimize(menu, noFees, [], opts({ budget: 1900 }));
      expect(r.best).toBeNull();
      const onlySides = optimize([menu[0]], noFees, [], opts());
      expect(onlySides.best).toBeNull();
      expect(onlySides.reason).toMatch(/fel principal/);
    });

    it("'none' drops sides, 'any' goes back to pure grams", () => {
      const none = optimize(menu, noFees, [], opts({ budget: 5200, sides: "none" }));
      expect(none.best!.lines.map((l) => l.itemId)).toEqual(["burger"]);
      const any = optimize(menu, noFees, [], opts({ budget: 3000, sides: "any" }));
      expect(any.best!.lines.every((l) => l.kind === "side")).toBe(true);
    });

    it("adds exactly one drink when drinks are wanted, a soda rather than water", () => {
      const items = [
        item("Apă plată 0,5L", 400, 500, { kind: "drink" }),
        item("Espresso", 300, 30, { kind: "drink" }),
        item("Coca-Cola 0,5L", 800, 500, { kind: "drink" }),
        item("Fanta 0,33L", 700, 330, { kind: "drink" }),
        item("burger", 2000, 200),
      ];
      const r = optimize(items, noFees, [], opts({ budget: 5000, includeDrinks: true, maxPerItem: 5 }));
      expect(r.best!.lines.map((l) => `${l.qty} ${l.itemId}`)).toEqual(["2 burger", "1 Fanta 0,33L"]);
      // Only the food counts as grams; the drink is paid for.
      expect(r.best!.grams).toBe(400);
      expect(r.best!.cost.total).toBe(4700);
      const none = optimize(items, noFees, [], opts({ budget: 5000 }));
      expect(none.best!.lines.some((l) => l.kind === "drink")).toBe(false);
    });
  });

  it("leaves salads and desserts out unless asked", () => {
    const items = [item("coleslaw", 500, 400, { kind: "other" }), item("burger", 2000, 200)];
    const r = optimize(items, noFees, [], opts({ budget: 2500 }));
    expect(r.best!.lines.map((l) => l.itemId)).toEqual(["burger"]);
    const w = optimize(items, noFees, [], opts({ budget: 2500, includeOther: true }));
    expect(w.best!.lines.map((l) => l.itemId)).toEqual(["burger", "coleslaw"]);
  });

  it("excludes drinks, sauces and items without weight by default", () => {
    const items = [
      item("cola", 500, 500, { kind: "drink" }),
      item("sos", 100, 50, { kind: "sauce" }),
      item("mystery", 100, null),
      item("burger", 2000, 200),
    ];
    const r = optimize(items, noFees, [], opts());
    expect(r.best!.lines.map((l) => l.itemId)).toEqual(["burger"]);
    const withDrinks = optimize(items, noFees, [], opts({ includeDrinks: true }));
    expect(withDrinks.best!.lines.some((l) => l.itemId === "cola")).toBe(true);
  });
});

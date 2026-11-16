import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeCost } from "../src/lib/optimizer";
import { nearestCity, parseGlovoStoreList, parseGlovoStorePage } from "../src/lib/platforms/glovo";
import { parseWoltMenu } from "../src/lib/platforms/wolt";
import { borrowWeights, deriveComboWeights } from "../src/lib/service";
import type { MenuItem } from "../src/lib/types";
import { baseName } from "../src/lib/weight";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("Wolt parser (real Burger King response, trimmed)", () => {
  const menu = parseWoltMenu(
    JSON.parse(fixture("wolt_assortment.json")),
    JSON.parse(fixture("wolt_dynamic.json")),
    "Burger King Victoriei",
  );
  const byName = (n: string) => menu.items.find((i) => i.name === n)!;

  it("reads items with price and weight", () => {
    expect(menu.items).toHaveLength(14);
    expect(byName("Cartofi Prime 160 g")).toMatchObject({ price: 1590, grams: 160, kind: "side" });
    expect(byName("Cheesy Bacon Dragon Balls").grams).toBeNull();
  });

  it("applies public item discounts", () => {
    expect(byName("Snack Share")).toMatchObject({ price: 5936, originalPrice: 7420 }); // -20%
    expect(byName("Meniu Double Cheeseburger")).toMatchObject({ price: 3735, originalPrice: 4150 }); // -10%
    expect(byName("Triple Deal").price).toBe(11760); // -25%
  });

  it("keeps new-user offers out of the maths", () => {
    expect(menu.offers.some((o) => o.kind === "percent" || o.kind === "freeDelivery")).toBe(false);
    expect(menu.offers.filter((o) => /utilizatori noi/.test(o.label))).toHaveLength(2);
  });

  it("reads delivery and basket-dependent fees", () => {
    expect(menu.fees.deliveryFee).toBe(1179);
    expect(menu.fees.basketFeeRanges).toHaveLength(3);
    // 8% between 31.13 and 99.88 lei, 7.99 above, top-up below
    expect(computeCost(5000, menu.fees, [], "total").serviceFee).toBe(400);
    expect(computeCost(20000, menu.fees, [], "total").serviceFee).toBe(799);
    expect(computeCost(2000, menu.fees, [], "total").serviceFee).toBe(1362);
  });
});

describe("Glovo parser (real store page, trimmed)", () => {
  const parsed = parseGlovoStorePage(fixture("glovo_store.html"))!;

  it("reads the store and its fees", () => {
    expect(parsed.storeName).toBe("FRYDAY");
    expect(parsed.fees.deliveryFee).toBe(699);
    expect(parsed.fees.serviceFee).toEqual({ flat: 699 });
  });

  it("reads products once, with promo price and mandatory packaging", () => {
    const ids = parsed.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const burger = parsed.items.find((i) => i.name.startsWith("DUBLU SMASHED BURGER"))!;
    expect(burger.price).toBe(3547); // 34.48 promo + 0.99 packaging
    expect(burger.originalPrice).toBe(4982);
  });

  it("classifies sauces, drinks and sides", () => {
    expect(parsed.items.find((i) => i.name.endsWith("Truffle 100ml"))).toMatchObject({ kind: "sauce", grams: 100 });
    // listed under "Promoții" first, but belongs to its real category
    expect(parsed.items.find((i) => i.name === "Black Truffle Smashed")?.category).toBe("Single Smashed Beef Burger");
    expect(parsed.items.find((i) => i.name === "REALLY CRUNCHY FRIES")?.kind).toBe("side");
    expect(parsed.items.filter((i) => i.category === "Drinks").every((i) => i.kind === "drink")).toBe(true);
  });

  it("returns null for a page without a store", () => {
    expect(parseGlovoStorePage("<html><body>404</body></html>")).toBeNull();
  });
});

describe("Glovo store list", () => {
  it("reads entries and filter types", () => {
    const { entries, types } = parseGlovoStoreList(fixture("glovo_list.html"));
    expect(entries.map((e) => e.slug)).toContain("kentucky-fried-chicken");
    expect(entries).toHaveLength(6);
    expect(types).toEqual(["fast-food_34983", "burgeri_34789"]);
  });
  it("picks the nearest city", () => {
    expect(nearestCity(44.43, 26.1).slug).toBe("bucharest");
    expect(nearestCity(46.77, 23.6).slug).toBe("cluj-napoca");
  });
});

describe("borrowWeights", () => {
  const mk = (name: string, grams: number | null): MenuItem => ({
    id: name, name, description: "", category: "", price: 1000, grams, kind: "food",
  });
  it("normalises names to a shared key", () => {
    expect(baseName("Big Mac, burger de vită cu castraveţi muraţi, sos, 240 gr")).toBe("big mac");
    expect(baseName("Big Mac™")).toBe("big mac");
    expect(baseName("Cartofi Prime 160 g")).toBe("cartofi prime");
  });
  it("fills a missing weight from the other platform and flags it", () => {
    const [a, b] = borrowWeights([[mk("Big Mac, burger, 240 gr", 240)], [mk("Big Mac™", null), mk("Altceva", null)]]);
    expect(a.borrowed).toBe(0);
    expect(b.borrowed).toBe(1);
    expect(b.items[0]).toMatchObject({ grams: 240, weightUncertain: true, weightSource: "other-platform" });
    expect(b.items[1].grams).toBeNull();
  });
  it("does not borrow when sizes disagree", () => {
    const [, b] = borrowWeights([[mk("Cartofi 100 g", 100), mk("Cartofi 150 g", 150)], [mk("Cartofi", null)]]);
    expect(b.items[0].grams).toBeNull();
  });
});

describe("deriveComboWeights", () => {
  const mk = (name: string, grams: number | null, kind: MenuItem["kind"] = "food"): MenuItem => ({
    id: name, name, description: "", category: "", price: 1000, grams, kind,
  });
  const menu = [
    mk("Big Mac, burger de vită cu castraveţi muraţi, sos, 240 gr", 240),
    mk("McCrispy®, sendviş cu pui, cheddar, 185 gr", 185),
    mk("McCrispy® Fresh, sendviş cu pui, salată, 210 gr", 210),
    mk("Aripioare de pui (5 buc.), produs picant, 180 gr", 180),
    mk("Aripioare de pui (9 buc.), produs picant, 300 gr", 300),
    mk("Cartofi prăjiţi porţie mare, 150 gr", 150, "side"),
    mk("MENIU MAXI BIG MAC™", null),
    mk("MENIU MCCRISPY MAXI", null),
    mk("MENIU MCCRISPY FRESH MAXI", null),
    mk("MENIU ARIPIOARE DE PUI 5 BUCATI MAXI", null),
    mk("MENIU MAXI BIG TASTY™", null),
    mk("Happy Meal™ Hamburger", null),
  ];
  const out = deriveComboWeights(menu);
  const grams = (name: string) => out.items.find((i) => i.name === name)?.grams;

  it("adds the sandwich and the large fries", () => {
    expect(grams("MENIU MAXI BIG MAC™")).toBe(390);
    expect(grams("MENIU MCCRISPY MAXI")).toBe(335);
    expect(grams("MENIU MCCRISPY FRESH MAXI")).toBe(360);
    expect(grams("MENIU ARIPIOARE DE PUI 5 BUCATI MAXI")).toBe(330);
    expect(out.items.find((i) => i.name === "MENIU MAXI BIG MAC™")).toMatchObject({
      weightSource: "derived",
      weightUncertain: true,
    });
  });

  it("leaves a combo alone when the sandwich is not on the menu", () => {
    expect(grams("MENIU MAXI BIG TASTY™")).toBeNull();
    expect(grams("Happy Meal™ Hamburger")).toBeNull();
    expect(out.derived).toBe(4);
  });
});

describe("deriveComboWeights: menus described only by their sandwich", () => {
  const mk = (name: string, grams: number | null, extra: Partial<MenuItem> = {}): MenuItem => ({
    id: name, name, description: "", category: "", price: 1000, grams, kind: "food", ...extra,
  });
  const out = deriveComboWeights([
    mk("Meniu Bacon & Cheese Whopper", 359, { weightSource: "description" }),
    mk("Bacon& Cheese Whopper", null),
    mk("Whopper", null),
    mk("Meniu Twister", 300, { weightSource: "description", includes: { fries: true, drink: true } }),
    mk("Cartofi prăjiți porție medie", 116, { kind: "side", weightSource: "description" }),
  ]).items;
  const get = (name: string) => out.find((i) => i.name === name)!;

  it("gives the sandwich its weight and adds the fries to the menu", () => {
    expect(get("Bacon& Cheese Whopper")).toMatchObject({ grams: 359, weightSource: "derived", weightUncertain: true });
    expect(get("Meniu Bacon & Cheese Whopper")).toMatchObject({ grams: 475, includes: { fries: true, drink: true } });
  });

  it("leaves other products and full menu descriptions alone", () => {
    expect(get("Whopper").grams).toBeNull();
    expect(get("Meniu Twister").grams).toBe(300);
  });
});

describe("deriveComboWeights: glazed pieces", () => {
  const mk = (name: string, grams: number | null): MenuItem => ({
    id: name, name, description: "", category: "", price: 1000, grams, kind: "food",
  });
  const out = deriveComboWeights([
    mk("5 buc. Fillet Nuggets", 100),
    mk("5 buc. Voodoo Fillet Nuggets", 200),
    mk("8 buc. Fillet Nuggets", 160),
    mk("5 buc. Classic Wings", 114),
    mk("5 buc. Voodoo Wings", 214),
    mk("Chicken Sandwich", 214),
  ]).items;
  const get = (name: string) => out.find((i) => i.name === name)!;

  it("counts the glazed pieces as the plain ones", () => {
    expect(get("5 buc. Voodoo Fillet Nuggets")).toMatchObject({ grams: 100, weightUncertain: true });
    expect(get("5 buc. Voodoo Wings").grams).toBe(114);
    expect(get("8 buc. Fillet Nuggets").grams).toBe(160);
    expect(get("Chicken Sandwich").grams).toBe(214);
  });
});

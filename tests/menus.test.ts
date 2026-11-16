import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eligibleItems, optimize } from "../src/lib/optimizer";
import { enrichItem, type RawItem } from "../src/lib/platforms/enrich";
import { borrowWeights, deriveComboWeights } from "../src/lib/service";
import type { FeeRules, MenuItem, Offer, OptimizeOptions } from "../src/lib/types";

/**
 * Real menus saved by `npm run snapshot`. Each chain goes through the whole
 * path (weights, kinds, basket) and the baskets are compared with the ones
 * recorded in __snapshots__: a change there is a menu change or a mistake.
 */
interface Saved {
  chain: string;
  platform: string;
  venue: string;
  fees: FeeRules;
  offers: Offer[];
  items: Omit<RawItem, "id">[];
}

const dir = path.join(__dirname, "menus");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
const byChain = new Map<string, Saved[]>();
for (const f of files.sort()) {
  const saved = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Saved;
  byChain.set(saved.chain, [...(byChain.get(saved.chain) ?? []), saved]);
}

const base: OptimizeOptions = {
  budget: 7000,
  scope: "total",
  mode: "hard",
  tolerancePct: 10,
  maxPerItem: 3,
  includeDrinks: false,
  includeSauces: false,
  sides: "none",
};
const everything: Partial<OptimizeOptions> = { includeDrinks: true, includeSauces: true, wantFries: true, sides: "balanced" };

function prepare(saved: Saved[]): MenuItem[][] {
  const enriched = saved.map((s) => s.items.map((raw, i) => enrichItem({ ...raw, id: String(i) }, s.venue)));
  return borrowWeights(enriched.map((items) => deriveComboWeights(items).items)).map((b) => b.items);
}

describe.each([...byChain])("%s", (_chain, saved) => {
  const menus = prepare(saved);

  it.each(saved.map((s, i) => [s.platform, i] as const))("%s: baskets", (_platform, i) => {
    const run = (o: Partial<OptimizeOptions>) => {
      const b = optimize(menus[i], saved[i].fees, saved[i].offers, { ...base, ...o }).best;
      return b ? [...b.lines.map((l) => `${l.qty}x ${l.name} | ${l.kind} | ${l.lineGrams} g`), `= ${b.grams} g, ${b.cost.total} bani`] : null;
    };
    expect({
      "70 lei": run({}),
      "120 lei": run({ budget: 12000 }),
      "70 lei, cu de toate": run(everything),
    }).toMatchSnapshot();
  });

  it.each(saved.map((s, i) => [s.platform, i] as const))("%s: no main dish is implausibly cheap or heavy", (_platform, i) => {
    // Real fast food costs at least ~6 lei per 100 g and one product is not 1.5 kg
    // unless it is a bucket to share: anything else is a weight read wrongly.
    const odd = eligibleItems(menus[i], base)
      .filter((it) => it.kind === "food")
      .filter((it) => {
        const g = (it.grams as number) * (it.unitsPerPurchase ?? 1);
        return it.price / g < 4 || (g > 1500 && !/bucket|box|for \d|pentru \d|pack|party/i.test(it.name));
      })
      .map((it) => `${it.name}: ${it.grams} g, ${it.price} bani`);
    expect(odd).toEqual([]);
  });

  it.each(saved.map((s, i) => [s.platform, i] as const))("%s: only main dishes fill the basket by default", (_platform, i) => {
    const b = optimize(menus[i], saved[i].fees, saved[i].offers, { ...base, budget: 12000 }).best;
    expect((b?.lines ?? []).filter((l) => l.kind !== "food").map((l) => l.name)).toEqual([]);
  });
});

it("has saved menus to check", () => {
  expect(files.length).toBeGreaterThan(0);
});

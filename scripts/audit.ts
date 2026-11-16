// A look at what the optimizer makes of a chain's live menu: the products it
// considers the best value, and the baskets for a few budgets. Wrong weights and
// wrong kinds show up at the top of the list.
//   npm run audit -- kfc "burger king"
import { eligibleItems, optimize } from "../src/lib/optimizer";
import { adapters } from "../src/lib/platforms";
import { borrowWeights, deriveComboWeights, searchAll } from "../src/lib/service";
import type { OptimizeOptions, PlatformMenu, Venue } from "../src/lib/types";

const lat = 44.4268;
const lon = 26.1025;
const base: OptimizeOptions = {
  budget: 0,
  scope: "total",
  mode: "hard",
  tolerancePct: 10,
  maxPerItem: 3,
  includeDrinks: false,
  includeSauces: false,
  sides: "none",
};
const everything: Partial<OptimizeOptions> = { includeDrinks: true, includeSauces: true, wantFries: true, sides: "balanced" };
const lei = (b: number) => (b / 100).toFixed(2);

for (const q of process.argv.slice(2)) {
  const venues = (await searchAll(q, lat, lon)).map((p) => p.venues[0]).filter(Boolean) as Venue[];
  const menus: { venue: Venue; menu: PlatformMenu }[] = [];
  for (const venue of venues) {
    try {
      menus.push({ venue, menu: await adapters.find((a) => a.id === venue.platform)!.getMenu(venue, lat, lon) });
    } catch (e) {
      console.log(`${q} · ${venue.platform}: ${(e as Error).message}`);
    }
  }
  const filled = borrowWeights(menus.map((m) => deriveComboWeights(m.menu.items).items));
  menus.forEach(({ venue, menu }, i) => {
    const items = filled[i].items;
    console.log(`\n#### ${q} · ${venue.platform} · ${venue.name} (${items.length} produse)`);
    const per100 = (it: (typeof items)[number]) => it.price / ((it.grams as number) * (it.unitsPerPurchase ?? 1));
    const seen = new Set<string>();
    const top = eligibleItems(items, base)
      .filter((it) => !seen.has(it.name) && !!seen.add(it.name))
      .sort((a, b) => per100(a) - per100(b))
      .slice(0, 14);
    for (const it of top) {
      console.log(
        `   ${per100(it).toFixed(1)} lei/100g | ${it.kind} | ${it.grams}g${it.weightUncertain ? "~" : ""} ${it.weightSource} | ${lei(it.price)} | ${it.name} | ${it.description.slice(0, 70).replace(/\s+/g, " ")}`,
      );
    }
    const runs: [string, Partial<OptimizeOptions>][] = [
      ["40", { budget: 4000 }],
      ["70", { budget: 7000 }],
      ["70 cu de toate", { budget: 7000, ...everything }],
      ["120", { budget: 12000 }],
      ["70 proteine", { budget: 7000, objective: "protein" }],
    ];
    for (const [label, o] of runs) {
      const r = optimize(items, menu.fees, menu.offers, { ...base, ...o });
      const b = r.best;
      console.log(
        ` [${label}] ` +
          (b
            ? b.lines.map((l) => `${l.qty}x ${l.name}${l.weightUncertain ? "~" : ""} (${l.kind} ${l.lineGrams}g ${lei(l.lineTotal)})`).join(" + ") +
              ` => ${b.grams}g, ${Math.round(b.protein)}g proteine${b.proteinEstimated ? "~" : ""}, ${lei(b.cost.total)}`
            : r.reason),
      );
    }
  });
}

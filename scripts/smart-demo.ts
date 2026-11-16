// Run the assistant on a saved menu: npm run demo -- kfc glovo 50 [must1;must2] [prefer1;prefer2] [cat,cat]
import fs from "node:fs";
import path from "node:path";
import { optimize } from "../src/lib/optimizer";
import { enrichItem } from "../src/lib/platforms/enrich";
import { deriveComboWeights } from "../src/lib/service";
import { recommend } from "../src/lib/smart";
import type { DishCategory, OptimizeOptions } from "../src/lib/types";

const [chain = "kfc", platform = "glovo", lei = "50", must = "", prefer = "", cats = ""] = process.argv.slice(2);
const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "../tests/menus", `${chain}.${platform}.json`), "utf8"));
const items = deriveComboWeights(saved.items.map((r: Record<string, unknown>, i: number) => enrichItem({ ...(r as never as Parameters<typeof enrichItem>[0]), id: String(i) }, saved.venue))).items;
const opts: OptimizeOptions = {
  budget: Math.round(Number(lei) * 100), scope: "total", mode: "hard", tolerancePct: 10, maxPerItem: 3,
  includeDrinks: false, includeSauces: false, sides: "balanced",
  preferences: {
    must: must ? must.split(";") : [], prefer: prefer ? prefer.split(";") : [],
    preferCategories: (cats ? cats.split(",") : []) as DishCategory[],
  },
};
const t = Date.now();
const legacy = optimize(items, saved.fees, saved.offers, { ...opts, includeDrinks: true });
const r = recommend(items, saved.fees, saved.offers, opts, legacy);
console.log(`${Date.now() - t} ms; legacy max grams: ${legacy.best?.grams}`);
console.log(r.reason ?? "", r.unmet, r.notes);
for (const s of r.suggestions) {
  console.log(`\n## ${s.label}  score ${s.score.toFixed(3)}  ${(s.basket.cost.counted / 100).toFixed(2)} lei  ${Math.round(s.basket.grams)} g  kcal ${s.kcal ? Math.round(s.kcal.total) : "-"}  prot ${s.protein ? Math.round(s.protein.total) : "-"}`);
  for (const l of s.basket.lines) console.log(`  ${l.qty}x ${l.name} (${(l.lineTotal / 100).toFixed(2)})`);
  console.log("  tradeoffs:", s.tradeoffs.join(" | "));
  for (const e of s.explanation) console.log("  -", e);
}
if (process.env.DEBUG_ALTS) console.log(JSON.stringify(r.suggestions.map((s) => [s.label, s.score])));

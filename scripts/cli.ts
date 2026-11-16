// Quick check from the terminal, without the web UI:
//   npm run cli -- "mcdonalds" 50 [lat] [lon]
import { optimizeAll, searchAll } from "../src/lib/service";
import { PLATFORM_NAMES, type Venue } from "../src/lib/types";

const [q = "mcdonalds", budgetLei = "50", latArg = "44.4268", lonArg = "26.1025"] = process.argv.slice(2);
const lat = Number(latArg);
const lon = Number(lonArg);
const lei = (b: number) => (b / 100).toFixed(2);

const found = await searchAll(q, lat, lon);
for (const p of found) {
  console.log(`${PLATFORM_NAMES[p.platform]}: ${p.error ?? p.venues.slice(0, 4).map((v) => v.name).join(" | ") ?? ""}`);
}
const venues = found.map((p) => p.venues[0]).filter(Boolean) as Venue[];
const results = await optimizeAll(venues, lat, lon, {
  budget: Math.round(Number(budgetLei) * 100),
  scope: "total",
  mode: "hard",
  tolerancePct: 10,
  maxPerItem: 3,
  includeDrinks: process.argv.includes("--drink"),
  wantFries: process.argv.includes("--fries"),
  includeSauces: process.argv.includes("--sauce"),
  sides: process.argv.includes("--fries") ? "balanced" : "none",
});
for (const r of results) {
  console.log(`\n== ${PLATFORM_NAMES[r.platform]} · ${r.venue.name} ${r.error ?? r.result?.reason ?? ""}`);
  const b = r.result?.best;
  if (b) {
    for (const l of b.lines) console.log(`  ${l.qty}x ${l.name}${l.weightUncertain ? " ~" : ""} | ${l.lineGrams} g | ${lei(l.lineTotal)}`);
    console.log(`  => ${b.grams} g, produse ${lei(b.cost.subtotal)} + livrare ${lei(b.cost.deliveryFee)} + taxe ${lei(b.cost.serviceFee + b.cost.smallOrderFee)} = ${lei(b.cost.total)} lei`);
  }
  console.log(`  produse folosite: ${r.stats?.usable}/${r.stats?.items}, gramaj preluat: ${r.stats?.borrowedWeights}, fără gramaj: ${r.missingWeight?.length}`);
}

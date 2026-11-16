// Saves today's real menus of the known chains under tests/menus/, so the tests
// can check the whole path (weights, kinds, basket) without the network:
//   npm run snapshot              all chains
//   npm run snapshot -- kfc       only the ones whose name contains the text
// After it, run `npx vitest run -u` and read the diff of tests/__snapshots__:
// every changed basket is either a menu change or a mistake.
import fs from "node:fs";
import path from "node:path";
import { CHAINS } from "../src/lib/chains";
import { adapters } from "../src/lib/platforms";
import { searchAll } from "../src/lib/service";
import { normalize } from "../src/lib/weight";

// Piața Unirii, Bucharest: a central address every chain delivers to.
const lat = 44.4268;
const lon = 26.1025;
const only = process.argv.slice(2).map(normalize);
const dir = path.join(process.cwd(), "tests", "menus");
fs.mkdirSync(dir, { recursive: true });

for (const chain of CHAINS) {
  const slug = normalize(chain.name).replace(/ /g, "-");
  if (only.length > 0 && !only.some((o) => normalize(chain.name).includes(o))) continue;
  for (const p of await searchAll(chain.name, lat, lon)) {
    const venue = p.venues[0];
    if (!venue) {
      console.log(`${chain.name} · ${p.platform}: ${p.error ?? "niciun local"}`);
      continue;
    }
    try {
      const menu = await adapters.find((a) => a.id === p.platform)!.getMenu(venue, lat, lon);
      const file = path.join(dir, `${slug}.${p.platform}.json`);
      const data = {
        chain: chain.name,
        platform: p.platform,
        venue: venue.name,
        savedOn: new Date().toISOString().slice(0, 10),
        fees: menu.fees,
        offers: menu.offers,
        // Only what the platform said; weight and kind are worked out again by the tests.
        items: menu.items.map((i) => ({
          name: i.name,
          description: i.description,
          category: i.category,
          price: i.price,
          originalPrice: i.originalPrice,
          unitsPerPurchase: i.unitsPerPurchase,
        })),
      };
      fs.writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
      console.log(`${chain.name} · ${p.platform}: ${menu.items.length} produse -> ${path.relative(process.cwd(), file)}`);
    } catch (e) {
      console.log(`${chain.name} · ${p.platform}: ${(e as Error).message}`);
    }
  }
}

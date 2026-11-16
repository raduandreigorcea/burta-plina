// Lists every menu item with its kind and weight, to check the classification:
//   npx vite-node scripts/dump.ts "kfc" [lat] [lon]
import { adapters } from "../src/lib/platforms";
import { searchAll } from "../src/lib/service";

const [q = "kfc", latArg = "44.4268", lonArg = "26.1025"] = process.argv.slice(2);
const lat = Number(latArg);
const lon = Number(lonArg);

for (const p of await searchAll(q, lat, lon)) {
  const v = p.venues[0];
  if (!v) continue;
  const menu = await adapters.find((a) => a.id === p.platform)!.getMenu(v, lat, lon);
  console.log(`\n== ${p.platform} · ${v.name}`);
  for (const it of menu.items) {
    console.log(
      [it.kind, it.grams ?? "-", (it.price / 100).toFixed(2), it.category, it.name, it.description.slice(0, 400).replace(/\s+/g, " ")].join(" | "),
    );
  }
}

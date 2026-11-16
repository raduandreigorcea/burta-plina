import fs from "node:fs";
import path from "node:path";
import type { MenuItem } from "../types";
import { classify, comboIncludes, lookupWeight, parseWeight, type WeightTable } from "../weight";

let tables: WeightTable[] | null = null;

/** Loads data/weights/*.json (manual weights per chain). */
export function loadWeightTables(): WeightTable[] {
  if (tables && process.env.NODE_ENV === "production") return tables;
  const dir = path.join(process.cwd(), "data", "weights");
  const out: WeightTable[] = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const t = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as WeightTable;
        if (Array.isArray(t.match) && t.items) out.push(t);
      } catch {
        // ignore a broken file rather than failing every request
      }
    }
  } catch {
    // no data dir
  }
  tables = out;
  return out;
}

export interface RawItem {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  price: number;
  originalPrice?: number;
  unitsPerPurchase?: number;
}

/** Adds weight + kind to a raw platform item. */
export function enrichItem(raw: RawItem, venueName: string): MenuItem {
  const name = raw.name.trim();
  const description = (raw.description ?? "").trim();
  const category = (raw.category ?? "").trim();
  const parsed = parseWeight(name, description);
  let grams: number | null = parsed?.grams ?? null;
  let weightSource: MenuItem["weightSource"] = parsed?.source;
  let weightUncertain = parsed?.uncertain || undefined;

  const manual = lookupWeight(loadWeightTables(), venueName, name);
  if (manual != null) {
    grams = manual;
    weightSource = "table";
    weightUncertain = undefined;
  }

  return {
    id: raw.id,
    name,
    description,
    category,
    price: raw.price,
    originalPrice: raw.originalPrice && raw.originalPrice > raw.price ? raw.originalPrice : undefined,
    unitsPerPurchase: raw.unitsPerPurchase,
    grams,
    weightSource,
    weightUncertain,
    kind: classify(name, category, parsed?.volume ?? false, parsed?.grams ?? null),
    includes: comboIncludes(name, description),
  };
}

import type { MenuItem } from "./types";

/**
 * Protein of one unit of a product, in grams. Taken from the menu text when it
 * has a nutrition line ("proteine: 5.01 g"), else estimated from what the
 * product is. Platforms do not publish nutrition in a structured way, so this
 * is the best available, and the estimate is marked as such.
 */
export interface Protein {
  grams: number;
  estimated: boolean;
}

const PROTEIN_RE = /prote[iî]n[ea]?\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d+(?:[.,]\d+)?)\s*g\b/i;
const KCAL_RE = /(\d+(?:[.,]\d+)?)\s*kcal/i;
const num = (s: string) => parseFloat(s.replace(",", "."));

/**
 * Protein written in the description, scaled to the whole unit. The text may
 * give the value for the whole product or per 100 g; the numbers tell which
 * (a whole 1.4 kg menu cannot have 160 kcal, a sauce cannot have 40 g protein).
 */
export function proteinFromText(description: string, grams: number): number | null {
  const p = description.match(PROTEIN_RE);
  if (!p || grams <= 0) return null;
  const value = num(p[1]);
  const kcal = description.match(KCAL_RE);
  let per100: boolean;
  if (kcal) per100 = num(kcal[1]) / grams < 0.5;
  else if (/(?:la|per|\/)\s*100\s*g/i.test(description)) per100 = true;
  else per100 = value / grams < 0.02;
  const total = per100 ? (value * grams) / 100 : value;
  const density = total / grams;
  // A food has 1-35 g of protein per 100 g; anything else was read wrongly.
  return density >= 0.01 && density <= 0.35 ? total : null;
}

const MEAT = /\b(pui|chicken|vita|vit[aă]|beef|burger|whopper|steak|gyros|kebab|kebap|doner|curcan|porc|carne|nuggets|strips|wings|tenders|bacon|miel|sunca|șuncă|salam|pepperoni|snitel|șnițel|crispy|twister|wrap|sandwich|sandvis|sub)\b/i;

/** Estimated protein per 100 g for a kind of product. */
function densityPer100(it: MenuItem): number {
  const n = it.name;
  if (it.kind === "sauce" || it.kind === "drink") return it.kind === "sauce" ? 1 : 0;
  if (it.kind === "side") return 3.5;
  if (it.kind === "dessert") return 4;
  if (it.kind === "salad") return 6;
  if (/pizza/i.test(n)) return 10;
  if (/falafel|vegan|veggie|vegetarian|plant/i.test(n) && !MEAT.test(n.replace(/falafel/i, ""))) return 6.5;
  if (MEAT.test(n) || MEAT.test(it.description)) return it.includes?.fries ? 10 : 12.5;
  return 8;
}

const cache = new WeakMap<MenuItem, Protein>();

export function proteinOf(it: MenuItem): Protein {
  const hit = cache.get(it);
  if (hit) return hit;
  const grams = it.grams ?? 0;
  const text = proteinFromText(it.description, grams);
  const out: Protein = text != null ? { grams: text, estimated: false } : { grams: (grams * densityPer100(it)) / 100, estimated: true };
  cache.set(it, out);
  return out;
}

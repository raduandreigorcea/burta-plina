import type { MenuItem } from "./types";

/**
 * Calories and protein of ONE unit of a product, read from the nutrition line
 * the restaurant wrote in the menu text. Nothing is estimated: when the text
 * is missing, ambiguous (several products in one description) or its basis
 * (per 100 g or per portion) cannot be told, the value is null.
 */
export interface Nutrition {
  kcal: number | null;
  protein: number | null;
}

const num = (s: string) => parseFloat(s.replace(",", "."));

const KCAL_RES = [
  /(\d+(?:[.,]\d+)?)\s*kcal/gi, // "218 kcal", "65.11KCal"
  /kcal\s*[:=]\s*(\d+(?:[.,]\d+)?)/gi, // "Kcal: 486,438"
  /kj\s*\/\s*kcal\)?\s*:\s*\d+(?:[.,]\d+)?\s*\/\s*(\d+(?:[.,]\d+)?)/gi, // "(Kj/kcal): 152/36"
];
const PROTEIN_RE = /prote[iî]ne?\s*[:=]\s*(\d+(?:[.,]\d+)?)/gi; // "Proteine: 1.31g"; not "proteine din soia"
const PER_100 = /(?:per|la|pe|\/)\s*100\s*g/i;
const WHOLE = /valori\s+nutri[tț]ionale\s*(\d+(?:[.,]\d+)?)\s*g/i;

function all(re: RegExp, text: string): number[] {
  return [...text.matchAll(re)].map((m) => num(m[1]));
}

/** Pure parser, exported for tests. `grams` is the weight of one unit. */
export function parseNutrition(description: string, grams: number): Nutrition {
  const none: Nutrition = { kcal: null, protein: null };
  if (!description || !(grams > 0)) return none;
  const kcals = KCAL_RES.flatMap((re) => all(re, description));
  const proteins = all(PROTEIN_RE, description);
  // Several values: the text describes several products (a box, a menu with variants).
  if (new Set(kcals).size > 1 || new Set(proteins).size > 1) return none;
  const kcal = kcals[0];
  const protein = proteins[0];
  if (kcal == null && protein == null) return none;

  // Is the value for 100 g or for the whole unit?
  let basis: "per100" | "whole" | null = null;
  const whole = description.match(WHOLE);
  if (PER_100.test(description)) basis = "per100";
  else if (whole && Math.abs(num(whole[1]) - grams) <= grams * 0.1) basis = "whole";
  // A whole fast-food portion below 50 kcal per 100 g does not exist: it is per 100 g.
  else if (kcal != null && kcal / grams < 0.5) basis = "per100";
  if (!basis) return none;

  const scale = (v: number) => (basis === "per100" ? (v * grams) / 100 : v);
  let outKcal = kcal != null ? scale(kcal) : null;
  let outProtein = protein != null ? scale(protein) : null;
  // Sanity: kcal per 100 g within what food can be, protein at most what kcal allow.
  if (outKcal != null) {
    const d = (outKcal / grams) * 100;
    if (d < 10 || d > 900) outKcal = null;
  }
  if (outProtein != null) {
    const d = (outProtein / grams) * 100;
    if (d > 45 || (outKcal != null && outProtein * 4 > outKcal * 1.1)) outProtein = null;
  }
  return { kcal: outKcal, protein: outProtein };
}

const cache = new WeakMap<MenuItem, Nutrition>();

/** Nutrition of one unit (not one purchase: a 1+1 offer gives `unitsPerPurchase` units). */
export function nutritionOf(it: MenuItem): Nutrition {
  let n = cache.get(it);
  if (!n) {
    n = parseNutrition(it.description, it.grams ?? 0);
    cache.set(it, n);
  }
  return n;
}

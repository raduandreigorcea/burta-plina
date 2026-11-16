import { optimizeAll } from "@/lib/service";
import type { DishCategory, OptimizeOptions, Preferences, ScoreWeights, Venue } from "@/lib/types";

interface Body {
  venues?: Venue[];
  lat?: number;
  lon?: number;
  options?: Partial<OptimizeOptions>;
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
};

const CATEGORIES: DishCategory[] = [
  "burger", "chicken", "pizza", "wrap", "sandwich", "kebab", "fries", "salad", "dessert", "drink", "sauce",
];
const WEIGHT_KEYS: (keyof ScoreWeights)[] = [
  "grams", "calories", "protein", "value", "variety", "preferItem", "preferCategory", "savings",
];

const names = (v: unknown) =>
  Array.isArray(v) ? v.filter((n): n is string => typeof n === "string").slice(0, 100) : [];
const categories = (v: unknown) =>
  Array.isArray(v) ? v.filter((c): c is DishCategory => CATEGORIES.includes(c as DishCategory)) : [];

function preferences(p: Partial<Preferences> | undefined): Preferences | undefined {
  if (!p || typeof p !== "object") return undefined;
  const weights: Partial<ScoreWeights> = {};
  for (const k of WEIGHT_KEYS) {
    const v = Number(p.weights?.[k]);
    if (p.weights?.[k] != null && Number.isFinite(v)) weights[k] = Math.min(10, Math.max(0, v));
  }
  return {
    must: names(p.must),
    prefer: names(p.prefer),
    mustCategories: categories(p.mustCategories),
    preferCategories: categories(p.preferCategories),
    weights,
    alternatives: Math.round(clamp(p.alternatives, 0, 4, 2)),
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Cerere invalidă." }, { status: 400 });
  }
  const { venues, lat, lon, options: o = {} } = body;
  if (!Array.isArray(venues) || venues.length === 0 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "Lipsește localul sau locația." }, { status: 400 });
  }
  const budget = Math.round(Number(o.budget));
  if (!Number.isFinite(budget) || budget < 100 || budget > 50000) {
    return Response.json({ error: "Bugetul trebuie să fie între 1 și 500 de lei." }, { status: 400 });
  }
  const options: OptimizeOptions = {
    budget,
    scope: o.scope === "food" ? "food" : "total",
    mode: o.mode === "flex" ? "flex" : "hard",
    tolerancePct: clamp(o.tolerancePct, 0, 50, 10),
    maxPerItem: Math.round(clamp(o.maxPerItem, 1, 20, 3)),
    includeDrinks: !!o.includeDrinks,
    wantFries: !!o.wantFries,
    includeSauces: !!o.includeSauces,
    wantSalad: !!o.wantSalad,
    wantDessert: !!o.wantDessert,
    includeGuessed: !!o.includeGuessed,
    includeOther: !!o.includeOther,
    sides: o.sides === "none" || o.sides === "any" ? o.sides : "balanced",
    excludeNames: Array.isArray(o.excludeNames)
      ? o.excludeNames.filter((n): n is string => typeof n === "string").slice(0, 200)
      : [],
    preferences: preferences(o.preferences),
  };
  const results = await optimizeAll(venues.slice(0, 6), lat as number, lon as number, options);
  return Response.json({ results, options });
}

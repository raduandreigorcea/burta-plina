import { optimizeAll } from "@/lib/service";
import type { OptimizeOptions, Venue } from "@/lib/types";

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
  };
  const results = await optimizeAll(venues.slice(0, 6), lat as number, lon as number, options);
  return Response.json({ results, options });
}

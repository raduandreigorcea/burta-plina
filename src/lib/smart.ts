import { computeCost, countsAsFood, eligibleItems, family, pickDrink, pickSauce, toLine } from "./optimizer";
import { nutritionOf } from "./nutrition";
import type {
  Bani,
  Basket,
  DishCategory,
  FeeRules,
  MenuItem,
  NutritionTotal,
  Offer,
  OptimizeOptions,
  OptimizeResult,
  ScoreWeights,
  SmartResult,
  SmartSuggestion,
} from "./types";
import { isFries, normalize } from "./weight";

/**
 * Multi-objective basket search.
 *
 * Every basket gets a score in which each part is a fraction of "what this
 * budget could buy at the best rate on this very menu", so grams, calories and
 * protein are comparable without hand-picked unit conversions:
 *
 *   t_grams   = food grams        / (budget x best grams per leu on the menu)
 *   t_cal     = calories          / (budget x best kcal  per leu on the menu)
 *   t_protein = protein           / (budget x best g     per leu on the menu)
 *   t_value   = the same metrics per leu really paid (fees included), i.e. the
 *               share of the best possible rate the basket achieves
 *
 *   score = weighted mean(t) x (1 - variety x (1 - distinct/units))
 *           + preferItem x (share of preferred products in the basket)
 *           + preferCategory x (share of preferred categories covered)
 *           + savings x (share of the budget left unspent)
 *
 * Hard constraints (budget, per-item cap, mandatory products and categories,
 * one extra per main, minimum order) are never traded for score: a basket that
 * breaks one cannot be recommended. Everything else is a trade-off the weights
 * decide. Calories and protein come only from nutrition text the menu itself
 * contains; products without it are scored with the median density of their
 * own kind on the same menu and are never shown as if they were measured.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  // The three amounts and the rate are equal: no metric is privileged a priori.
  // Calories and protein switch off by themselves when the menu has no data.
  grams: 1,
  calories: 1,
  protein: 1,
  value: 1,
  // Three identical products lose 0.3 x (1 - 1/3) = 20% of the value score:
  // enough to prefer a different product at a similar rate, not enough to
  // reject a clearly better-value product.
  variety: 0.3,
  // A wish is worth as much as 15 points of a 100-point value score.
  preferItem: 0.15,
  preferCategory: 0.15,
  // Off: the budget is meant to be used. Raise it to get cheaper baskets.
  savings: 0,
};

/** Which tradeoff each alternative stands for: overrides over the user's weights. */
export const PROFILES: { label: string; weights: Partial<ScoreWeights>; needs?: "protein" | "calories" }[] = [
  { label: "Echilibrat", weights: {} },
  { label: "Cât mai multă mâncare", weights: { grams: 3, value: 2, calories: 0.5, protein: 0.5, variety: 0.1 } },
  { label: "Mai multe proteine", weights: { protein: 4, grams: 0.5, value: 1 }, needs: "protein" },
  { label: "Mai variat", weights: { variety: 0.9 } },
  { label: "Mai ieftin", weights: { savings: 0.6 } },
];

const CATEGORY_RULES: [DishCategory, RegExp][] = [
  ["burger", /burger|whopper|big mac|mcroyal|cheeseburger|hamburger/],
  ["chicken", /\bpui\b|chicken|crispy|nuggets|strips|wings|aripioare|tenders|popcorn|zinger|twister|\bkfc\b/],
  ["pizza", /pizza/],
  ["wrap", /wrap|tortilla|taco|burrito|quesadilla|lipie|crunchwrap/],
  ["sandwich", /sandvis|sandwich|\bsub\b|baguette|panini|\bsubway\b/],
  ["kebab", /kebab|kebap|gyros|shaorma|doner|souvlaki|shawarma/],
];

export function categoriesOf(it: MenuItem): Set<DishCategory> {
  const out = new Set<DishCategory>();
  if (it.kind === "drink") out.add("drink");
  else if (it.kind === "sauce") out.add("sauce");
  else if (it.kind === "salad") out.add("salad");
  else if (it.kind === "dessert") out.add("dessert");
  else if (it.kind === "side") {
    if (isFries(it.name)) out.add("fries");
  } else if (it.kind === "food") {
    const text = normalize(`${it.name} ${it.category}`);
    for (const [c, re] of CATEGORY_RULES) if (re.test(text)) out.add(c);
  }
  // A combo brings its parts along.
  if (it.includes?.fries) out.add("fries");
  if (it.includes?.drink) out.add("drink");
  if (it.includes?.sauce) out.add("sauce");
  return out;
}

const NOISE = new Set([
  "meniu", "menu", "maxi", "mare", "mediu", "medie", "mic", "xl", "xxl", "combo", "classic", "clasic",
  "picant", "picanta", "nepicant", "nepicanta", "spicy", "hot", "cu", "si", "de", "la", "buc", "bucati", "g", "gr", "ml", "l",
]);
const tokens = (name: string) =>
  new Set(
    normalize(name)
      .split(" ")
      .filter((t) => t.length > 1 && !NOISE.has(t) && !/^\d/.test(t)),
  );
const jaccard = (a: Set<string>, b: Set<string>) => {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
};

interface Info {
  it: MenuItem;
  price: Bani;
  /** Food grams per purchase (drinks and sauces do not count). */
  grams: number;
  /** Nutrition per purchase, measured (null = the menu does not say). */
  kcal: number | null;
  protein: number | null;
  /** Per purchase, measured or (for scoring only) imputed. */
  kcalScore: number;
  proteinScore: number;
  cats: Set<DishCategory>;
  cluster: number;
  main: boolean;
  side: boolean;
  /** A main that brings fries along gives no "credit" for another side. */
  bringsSide: boolean;
  hasDrink: boolean;
  hasSauce: boolean;
  /** salad / dessert / other: needs a main dish to go with. */
  extra: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
};

function buildInfos(pool: MenuItem[]): { infos: Info[]; calOn: boolean; protOn: boolean } {
  const upp = (it: MenuItem) => it.unitsPerPurchase ?? 1;
  const nutr = pool.map((it) => nutritionOf(it));
  const densities = (pick: (n: (typeof nutr)[number]) => number | null) => {
    const byKind = new Map<string, number[]>();
    const everything: number[] = [];
    pool.forEach((it, i) => {
      const v = pick(nutr[i]);
      if (v == null || !it.grams) return;
      const d = v / it.grams;
      (byKind.get(it.kind) ?? byKind.set(it.kind, []).get(it.kind)!).push(d);
      if (it.kind !== "sauce" && it.kind !== "drink") everything.push(d);
    });
    const fallback = median(everything);
    return (kind: string) => (byKind.has(kind) ? median(byKind.get(kind)!) : fallback);
  };
  const kcalDensity = densities((n) => n.kcal);
  const protDensity = densities((n) => n.protein);
  const relevant = pool.filter((it) => it.kind !== "sauce");
  const coverage = (pick: (n: (typeof nutr)[number]) => number | null) =>
    relevant.filter((it) => pick(nutr[pool.indexOf(it)]) != null).length;
  const need = Math.max(3, Math.ceil(relevant.length * 0.4));
  const calOn = coverage((n) => n.kcal) >= need;
  const protOn = coverage((n) => n.protein) >= need;

  // Near-identical products share a cluster (same kind, mostly the same words).
  const toks = pool.map((it) => tokens(it.name));
  const cluster: number[] = [];
  const reps: number[] = [];
  pool.forEach((it, i) => {
    const hit = reps.find((r) => pool[r].kind === it.kind && jaccard(toks[r], toks[i]) >= 0.5);
    if (hit != null) cluster.push(cluster[hit]);
    else {
      reps.push(i);
      cluster.push(i);
    }
  });

  const infos = pool.map((it, i): Info => {
    const u = upp(it);
    const g = (it.grams as number) * u;
    const n = nutr[i];
    const kcal = n.kcal != null ? n.kcal * u : null;
    const protein = n.protein != null ? n.protein * u : null;
    return {
      it,
      price: it.price,
      grams: countsAsFood(it.kind) ? g : 0,
      kcal,
      protein,
      kcalScore: kcal ?? g * kcalDensity(it.kind),
      proteinScore: protein ?? g * protDensity(it.kind),
      cats: categoriesOf(it),
      cluster: cluster[i],
      main: it.kind === "food",
      side: it.kind === "side",
      bringsSide: !!it.includes?.fries,
      hasDrink: it.kind === "drink" || !!it.includes?.drink,
      hasSauce: it.kind === "sauce" || !!it.includes?.sauce,
      extra: it.kind === "salad" || it.kind === "dessert" || it.kind === "other",
    };
  });
  return { infos, calOn, protOn };
}

type Qty = Map<number, number>;
const sig = (q: Qty) =>
  [...q]
    .filter(([, k]) => k > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([i, k]) => `${i}x${k}`)
    .join(",");

interface Evaluation {
  subtotal: Bani;
  counted: Bani;
  over: boolean;
  violations: number;
  /** Score before the constraint penalty. */
  score: number;
  /** Score minus the penalty: what the search climbs. */
  climb: number;
  terms: Record<string, number>;
  grams: number;
}

const PENALTY = 3;

export function recommend(
  allItems: MenuItem[],
  fees: FeeRules,
  offers: Offer[],
  opts: OptimizeOptions,
  legacy?: OptimizeResult,
): SmartResult {
  const prefs = opts.preferences ?? {};
  const userWeights: ScoreWeights = { ...DEFAULT_WEIGHTS, ...prefs.weights };
  const unmet: string[] = [];
  const notes: string[] = [];

  // Drinks, sauces and sides are judged like anything else; salads and desserts only when asked for, and
  // the "other" kind (bread, toppings) stays opt-in, and sides follow their rule.
  const seen = new Set<string>();
  const pool = eligibleItems(allItems, {
    ...opts,
    includeDrinks: true,
    includeSauces: true,
    wantSalad: !!opts.wantSalad || !!prefs.mustCategories?.includes("salad"),
    wantDessert: !!opts.wantDessert || !!prefs.mustCategories?.includes("dessert"),
    sides: opts.sides === "none" ? "none" : (opts.sides ?? "balanced"),
  }).filter((it) => {
    const k = `${family(it.name)}|${it.price}|${it.grams}|${it.unitsPerPurchase ?? 1}`;
    return !seen.has(k) && !!seen.add(k);
  });
  const catalog = pool
    .map((it) => ({ name: it.name, price: it.price, kind: it.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const result = (r: Partial<SmartResult>): SmartResult => ({ suggestions: [], unmet, notes, catalog, ...r });

  const { infos, calOn, protOn } = buildInfos(pool);
  const n = infos.length;
  if (n === 0 || !infos.some((x) => x.main)) return result({ reason: "Niciun fel principal cu gramaj cunoscut." });

  const budget = opts.budget;
  const cap = Math.max(1, Math.min(opts.maxPerItem, 20));
  const balanced = (opts.sides ?? "balanced") !== "any";
  const noSides = opts.sides === "none";
  if (opts.mode === "flex") notes.push("Asistentul respectă bugetul exact; „Flexibil” se aplică doar căutării după grame.");

  // ---- references: the best rate of each metric on this menu ----
  const rated = infos.filter((x) => x.it.kind !== "sauce" && x.it.kind !== "drink");
  const best = (f: (x: Info) => number | null) => Math.max(1e-12, ...rated.map((x) => (f(x) ?? 0) / x.price));
  const refG = budget * best((x) => x.grams);
  const refK = budget * best((x) => x.kcal);
  const refP = budget * best((x) => x.protein);

  // ---- preferences resolved against the menu ----
  const byName = (names: string[] | undefined, label: string, record: boolean) => {
    const groups: number[][] = [];
    for (const raw of names ?? []) {
      const key = normalize(raw);
      const idx = infos.flatMap((x, i) => (normalize(x.it.name) === key ? [i] : []));
      if (idx.length) groups.push(idx);
      else if (record) unmet.push(`${label}: „${raw}” nu e în meniu (sau nu are gramaj).`);
    }
    return groups;
  };
  const musts = byName(prefs.must, "Obligatoriu", true);
  const prefers = byName(prefs.prefer, "Preferat", false);
  const supports = (c: DishCategory) => infos.some((x) => x.cats.has(c));
  const mustCats = (prefs.mustCategories ?? []).filter((c) => {
    if (supports(c)) return true;
    unmet.push(`Obligatoriu: restaurantul nu are „${c}”.`);
    return false;
  });
  const preferCats = (prefs.preferCategories ?? []).filter((c) => supports(c) && !mustCats.includes(c));

  function evaluate(q: Qty, w: ScoreWeights): Evaluation {
    let subtotal = 0;
    let grams = 0;
    let kcal = 0;
    let prot = 0;
    let mains = 0;
    let credits = 0;
    let sides = 0;
    let extras = 0;
    let drinks = 0;
    let sauces = 0;
    let units = 0;
    const clusters = new Set<number>();
    const cats = new Set<DishCategory>();
    for (const [i, k] of q) {
      if (k <= 0) continue;
      const x = infos[i];
      subtotal += x.price * k;
      grams += x.grams * k;
      kcal += x.kcalScore * k;
      prot += x.proteinScore * k;
      if (x.main) {
        mains += k;
        if (!x.bringsSide) credits += k;
      }
      if (x.side) sides += k;
      if (x.extra) extras += k;
      if (x.hasDrink) drinks += k;
      if (x.hasSauce) sauces += k;
      if (x.it.kind !== "sauce") {
        units += k;
        clusters.add(x.cluster);
      }
      for (const c of x.cats) cats.add(c);
    }
    const cost = computeCost(subtotal, fees, offers, opts.scope);
    const counted = cost.counted;
    const over = counted > budget;

    let violations = 0;
    for (const g of musts) if (!g.some((i) => (q.get(i) ?? 0) > 0)) violations++;
    for (const c of mustCats) if (!cats.has(c)) violations++;
    if (balanced) {
      if (mains < 1) violations++;
      if (!noSides) violations += Math.max(0, sides - credits);
      violations += Math.max(0, extras - mains);
      violations += Math.max(0, drinks - mains) + Math.max(0, sauces - mains);
    }
    if (noSides) violations += sides;
    if (subtotal < fees.minOrder) violations++;

    const t = {
      grams: grams / refG,
      calories: kcal / refK,
      protein: prot / refP,
    };
    // Share of the best rate, with the fees included.
    const rate = counted > 0 ? budget / counted : 0;
    const perLeu: number[] = [t.grams * rate];
    if (calOn) perLeu.push(t.calories * rate);
    if (protOn) perLeu.push(t.protein * rate);
    const value = Math.min(1.5, perLeu.reduce((a, b) => a + b, 0) / perLeu.length);

    const wc = calOn ? w.calories : 0;
    const wp = protOn ? w.protein : 0;
    const total = w.grams + wc + wp + w.value || 1;
    const terms: Record<string, number> = {
      greutate: (w.grams * t.grams) / total,
      calorii: (wc * t.calories) / total,
      proteine: (wp * t.protein) / total,
      valoare: (w.value * value) / total,
    };
    const base = Object.values(terms).reduce((a, b) => a + b, 0);
    const variety = units > 0 ? clusters.size / units : 1;
    terms.varietate = -base * w.variety * (1 - variety);
    const heldPrefs = prefers.filter((g) => g.some((i) => (q.get(i) ?? 0) > 0)).length;
    terms.preferate = prefers.length ? (w.preferItem * heldPrefs) / prefers.length : 0;
    const heldCats = preferCats.filter((c) => cats.has(c)).length;
    terms.categorii = preferCats.length ? (w.preferCategory * heldCats) / preferCats.length : 0;
    terms.economie = w.savings * Math.max(0, 1 - counted / budget);
    const score = Object.values(terms).reduce((a, b) => a + b, 0);
    return { subtotal, counted, over, violations, score, climb: score - PENALTY * violations, terms, grams };
  }

  const clone = (q: Qty): Qty => new Map(q);
  const bump = (q: Qty, i: number, d: number): Qty | null => {
    const k = (q.get(i) ?? 0) + d;
    if (k < 0 || k > cap) return null;
    const m = clone(q);
    if (k === 0) m.delete(i);
    else m.set(i, k);
    return m;
  };

  /** Steepest ascent over add / remove / swap / add-and-repair moves. */
  function climb(start: Qty, w: ScoreWeights): Qty {
    let cur = start;
    let curEv = evaluate(cur, w);
    for (let iter = 0; iter < 80; iter++) {
      let bestQ: Qty | null = null;
      let bestV = curEv.climb + 1e-9;
      const consider = (m: Qty | null) => {
        if (!m) return;
        const ev = evaluate(m, w);
        if (!ev.over && ev.climb > bestV) {
          bestV = ev.climb;
          bestQ = m;
        }
      };
      const held = [...cur.keys()];
      for (let i = 0; i < n; i++) {
        consider(bump(cur, i, 1));
        const added = bump(cur, i, 1);
        if (added && evaluate(added, w).over) consider(repair(added, i, w));
      }
      for (const i of held) {
        const lowered = bump(cur, i, -1);
        consider(lowered);
        if (!lowered) continue;
        for (let j = 0; j < n; j++) if (j !== i) consider(bump(lowered, j, 1));
      }
      if (!bestQ) break;
      cur = bestQ;
      curEv = evaluate(cur, w);
    }
    return cur;
  }

  /** Over budget after adding `keep`: drop the units that hurt the score least. */
  function repair(q: Qty, keep: number, w: ScoreWeights): Qty | null {
    let m = q;
    for (let guard = 0; guard < 12; guard++) {
      if (!evaluate(m, w).over) return m;
      let next: Qty | null = null;
      let nextV = -Infinity;
      for (const i of m.keys()) {
        if (i === keep && (m.get(i) ?? 0) <= 1) continue;
        const c = bump(m, i, -1);
        if (!c) continue;
        const v = evaluate(c, w).climb;
        if (v > nextV) {
          nextV = v;
          next = c;
        }
      }
      if (!next) return null;
      m = next;
    }
    return null;
  }

  // ---- seeds ----
  const seeds: Qty[] = [new Map()];
  if (legacy?.best) {
    const idx = new Map(infos.map((x, i) => [x.it.id, i]));
    const q: Qty = new Map();
    for (const l of legacy.best.lines) {
      const i = idx.get(l.itemId);
      if (i != null) q.set(i, l.qty);
    }
    if (q.size > 0) seeds.push(q);
  }
  // Mandatory products first, so the search starts inside the constraint.
  const mustSeed: Qty = new Map();
  for (const g of musts) {
    const i = g.slice().sort((a, b) => infos[a].price - infos[b].price)[0];
    mustSeed.set(i, 1);
  }
  if (mustSeed.size > 0) seeds.push(mustSeed);

  const profiles = PROFILES.filter((p) => !(p.needs === "protein" && !protOn) && !(p.needs === "calories" && !calOn));
  const found: { q: Qty; label: string }[] = [];
  for (const p of profiles) {
    const w = { ...userWeights, ...p.weights };
    // Wishes of the user (preferences and savings, when they set it) stay what they set.
    w.preferItem = userWeights.preferItem;
    w.preferCategory = userWeights.preferCategory;
    if (p.weights.savings == null) w.savings = userWeights.savings;
    let top: { q: Qty; v: number } | null = null;
    for (const s of [...seeds, ...found.map((f) => f.q)]) {
      const q = climb(s, w);
      const ev = evaluate(q, w);
      if (!ev.over && (!top || ev.climb > top.v)) top = { q, v: ev.climb };
    }
    if (top) found.push({ q: top.q, label: p.label });
  }

  const scored = found
    .map((f) => ({ ...f, ev: evaluate(f.q, userWeights) }))
    .filter((f) => f.q.size > 0 && !f.ev.over);
  const feasible = scored.filter((f) => f.ev.violations === 0);
  if (feasible.length === 0) {
    const reason =
      fees.minOrder > budget
        ? `Comanda minimă (${(fees.minOrder / 100).toFixed(2)} lei) depășește bugetul.`
        : musts.length + mustCats.length > 0
          ? "Produsele sau categoriile obligatorii nu încap în buget."
          : "Nu încape nimic în buget după taxe.";
    return result({ reason });
  }

  // Main suggestion: best under the user's own weights. Alternatives: the other
  // profiles' answers that are really different and not much worse.
  feasible.sort((a, b) => b.ev.score - a.ev.score);
  const primary = feasible[0];
  const chosen = [primary];
  const signatures = new Set([sig(primary.q)]);
  const wantAlts = Math.max(0, Math.min(4, prefs.alternatives ?? 2));
  for (const f of feasible.slice(1)) {
    if (chosen.length > wantAlts) break;
    const s = sig(f.q);
    if (signatures.has(s) || f.ev.score < primary.ev.score * 0.7) continue;
    signatures.add(s);
    chosen.push(f);
  }

  // ---- presentation ----
  const sumKnown = (q: Qty, pick: (x: Info) => number | null): NutritionTotal | null => {
    let total = 0;
    let known = 0;
    let units = 0;
    for (const [i, k] of q) {
      units += k;
      const v = pick(infos[i]);
      if (v != null) {
        total += v * k;
        known += k;
      }
    }
    return known > 0 ? { total, knownUnits: known, units } : null;
  };

  const lei = (b: number) => `${(Math.abs(b) / 100).toFixed(2).replace(".", ",")} lei`;
  const gr = (g: number) => `${Math.round(Math.abs(g))} g`;
  const standaloneMains = infos.filter((x) => x.main && !x.it.includes);
  const dealKey = (name: string) => [...tokens(name)].sort().join(" ");
  const cheapest = (list: Info[]) => list.slice().sort((a, b) => a.price - b.price)[0];
  const fries = cheapest(infos.filter((x) => x.side && isFries(x.it.name)));
  const drinkPick = pickDrink(pool.filter((i) => i.kind === "drink"));
  const sauce = pickSauce(pool.filter((i) => i.kind === "sauce"));

  /** What a combo saves against its parts bought one by one (cheapest of each on this menu). */
  const dealSaving = (x: Info): Bani | null => {
    const inc = x.it.includes;
    if (!inc || !x.main) return null;
    const key = dealKey(x.it.name);
    const main = cheapest(standaloneMains.filter((m) => dealKey(m.it.name) === key));
    if (!main) return null;
    let apart = main.price;
    if (inc.fries) {
      if (!fries) return null;
      apart += fries.price;
    }
    if (inc.drink) {
      if (!drinkPick) return null;
      apart += drinkPick.price;
    }
    if (inc.sauce) {
      if (!sauce) return null;
      apart += sauce.price;
    }
    return apart > x.price ? apart - x.price : null;
  };

  const suggestions: SmartSuggestion[] = chosen.map((c, idx) => {
    const lines = [...c.q]
      .map(([i, k]) => toLine(infos[i].it, k))
    const rank = (l: (typeof lines)[number]) => ({ food: 0, side: 1, other: 1, salad: 2, dessert: 3, sauce: 4, drink: 5 })[l.kind];
    lines.sort((a, b) => rank(a) - rank(b) || b.lineGrams - a.lineGrams);
    const cost = computeCost(c.ev.subtotal, fees, offers, opts.scope);
    const basket: Basket = {
      lines,
      grams: c.ev.grams,
      cost,
      leiPer100g: c.ev.grams > 0 ? cost.counted / c.ev.grams : 0,
    };
    const kcal = sumKnown(c.q, (x) => x.kcal);
    const protein = sumKnown(c.q, (x) => x.protein);
    const deals = [...c.q]
      .flatMap(([i, k]) => {
        const s = dealSaving(infos[i]);
        return s ? [{ name: infos[i].it.name, saves: s * k }] : [];
      });

    const ex: string[] = [];
    ex.push(
      `Costă ${lei(cost.counted)} din ${lei(budget)}${opts.scope === "total" ? " (cu livrare și taxe)" : ""}; rămân ${lei(budget - cost.counted)}.`,
    );
    const maxG = legacy?.best?.grams;
    if (maxG != null && basket.grams > 0) {
      const diff = maxG - basket.grams;
      ex.push(
        diff > 1
          ? `Față de varianta cu cele mai multe grame (${gr(maxG)}): ${gr(diff)} mai puțin${idx === 0 ? ", dar scorul total (cantitate, raport, varietate, preferințe) e mai bun" : ""}.`
          : `Nu pierzi grame față de varianta cu cele mai multe grame (${gr(maxG)}).`,
      );
    }
    const asked = [...c.q.keys()];
    const held = (g: number[]) => g.some((i) => asked.includes(i));
    const mustDone = musts.filter(held).map((g) => infos[g[0]].it.name);
    if (mustDone.length) ex.push(`Include ce ai cerut obligatoriu: ${mustDone.join(", ")}.`);
    if (prefers.length) {
      const yes = prefers.filter(held).map((g) => infos[g[0]].it.name);
      const no = prefers.filter((g) => !held(g)).map((g) => infos[g[0]].it.name);
      if (yes.length) ex.push(`Preferate incluse: ${yes.join(", ")}.`);
      if (no.length) ex.push(`Preferate rămase pe dinafară (nu merită față de alternative sau nu încap): ${no.join(", ")}.`);
    }
    if (preferCats.length || mustCats.length) {
      const covered = new Set<DishCategory>();
      for (const i of asked) for (const cat of infos[i].cats) covered.add(cat);
      const miss = preferCats.filter((cat) => !covered.has(cat));
      if (miss.length) ex.push(`Categorii dorite neacoperite: ${miss.join(", ")}.`);
    }
    for (const d of deals) ex.push(`„${d.name}” e meniu: costă cu ${lei(d.saves)} mai puțin decât produsele luate separat.`);
    const distinct = new Set(asked.map((i) => infos[i].cluster)).size;
    const unitCount = [...c.q].reduce((a, [i, k]) => a + (infos[i].it.kind === "sauce" ? 0 : k), 0);
    if (unitCount > 1)
      ex.push(
        distinct === unitCount
          ? `Toate cele ${unitCount} produse sunt diferite între ele.`
          : `${distinct} produse diferite din ${unitCount} bucăți: unele se repetă pentru că au cel mai bun raport.`,
      );
    const lead = Object.entries(c.ev.terms)
      .filter(([k, v]) => v > 0 && !["economie"].includes(k))
      .sort((a, b) => b[1] - a[1])[0];
    if (lead) ex.push(`Cel mai mult contribuie la scor: ${lead[0]}.`);

    return {
      label: idx === 0 ? `Recomandat · ${c.label}` : c.label,
      basket,
      remaining: budget - cost.counted,
      kcal,
      protein,
      score: c.ev.score,
      breakdown: c.ev.terms,
      explanation: ex,
      tradeoffs: [],
      deals,
    };
  });

  // Trade-offs against the main suggestion.
  const p0 = suggestions[0];
  for (const s of suggestions.slice(1)) {
    const t: string[] = [];
    const dG = s.basket.grams - p0.basket.grams;
    if (Math.abs(dG) >= 20) t.push(`${dG > 0 ? "+" : "−"}${gr(dG)} mâncare`);
    if (s.protein && p0.protein) {
      const d = s.protein.total - p0.protein.total;
      if (Math.abs(d) >= 3) t.push(`${d > 0 ? "+" : "−"}${Math.round(Math.abs(d))} g proteine`);
    }
    if (s.kcal && p0.kcal) {
      const d = s.kcal.total - p0.kcal.total;
      if (Math.abs(d) >= 50) t.push(`${d > 0 ? "+" : "−"}${Math.round(Math.abs(d))} kcal`);
    }
    const dP = s.basket.cost.counted - p0.basket.cost.counted;
    if (Math.abs(dP) >= 50) t.push(`${dP > 0 ? "+" : "−"}${lei(dP)}`);
    const dv = s.basket.lines.length - p0.basket.lines.length;
    if (dv !== 0) t.push(`${dv > 0 ? "+" : "−"}${Math.abs(dv)} produse diferite`);
    s.tradeoffs = t;
  }

  return result({ suggestions });
}

import { proteinOf } from "./nutrition";
import type {
  Bani,
  Basket,
  BasketLine,
  CostBreakdown,
  FeeRules,
  MenuItem,
  Objective,
  Offer,
  OptimizeOptions,
  OptimizeResult,
} from "./types";
import { isFries, normalize } from "./weight";

export function computeCost(
  subtotal: Bani,
  fees: FeeRules,
  offers: Offer[],
  scope: OptimizeOptions["scope"],
): CostBreakdown {
  // Best single cart discount (platforms do not stack them).
  let discount = 0;
  let freeDelivery = fees.freeDeliveryOver != null && subtotal >= fees.freeDeliveryOver;
  for (const o of offers) {
    if (o.kind === "info" || subtotal < o.minSubtotal) continue;
    if (o.kind === "percent") {
      let d = Math.round((subtotal * o.pct) / 100);
      if (o.maxDiscount != null) d = Math.min(d, o.maxDiscount);
      discount = Math.max(discount, d);
    } else if (o.kind === "amount") {
      discount = Math.max(discount, Math.min(o.amount, subtotal));
    } else if (o.kind === "freeDelivery") {
      freeDelivery = true;
    }
  }

  const deliveryFee = freeDelivery ? 0 : fees.deliveryFee;

  let smallOrderFee = 0;
  const so = fees.smallOrder;
  if (so && subtotal < so.threshold) {
    smallOrderFee = so.mode === "difference" ? so.threshold - subtotal : (so.flat ?? 0);
  }

  let serviceFee = 0;
  const sf = fees.serviceFee;
  if (sf) {
    let v = sf.pct ? Math.round((subtotal * sf.pct) / 100) : 0;
    if (sf.min != null) v = Math.max(v, sf.min);
    if (sf.max != null) v = Math.min(v, sf.max);
    serviceFee = v + (sf.flat ?? 0);
  }
  const range = fees.basketFeeRanges?.find(
    (r) => subtotal >= r.min && (r.max === 0 || subtotal < r.max),
  );
  if (range) serviceFee += Math.max(0, Math.round(range.a + range.b * subtotal));

  const food = subtotal - discount;
  const total = food + deliveryFee + serviceFee + smallOrderFee;
  return {
    subtotal,
    discount,
    deliveryFee,
    serviceFee,
    smallOrderFee,
    total,
    counted: scope === "total" ? total : food,
  };
}

/** Weight guessed from several numbers in the item text (not borrowed, not manual). */
export function isGuessed(it: MenuItem): boolean {
  return !!it.weightUncertain && (it.weightSource === "name" || it.weightSource === "description");
}

export function eligibleItems(items: MenuItem[], opts: OptimizeOptions): MenuItem[] {
  const excluded = new Set((opts.excludeNames ?? []).map(normalize));
  return items.filter(
    (it) =>
      it.grams != null &&
      !excluded.has(normalize(it.name)) &&
      (opts.includeGuessed || !isGuessed(it)) &&
      it.grams > 0 &&
      it.price > 0 &&
      (it.kind !== "side" || (opts.sides ?? "balanced") !== "none") &&
      (it.kind !== "other" || !!opts.includeOther) &&
      (it.kind !== "salad" || !!opts.wantSalad) &&
      (it.kind !== "dessert" || !!opts.wantDessert) &&
      (it.kind !== "drink" || opts.includeDrinks) &&
      (it.kind !== "sauce" || opts.includeSauces),
  );
}

const SODA_WORDS = [
  "cola", "pepsi", "fanta", "sprite", "mirinda", "7up", "suc", "lipton", "fuzetea", "schweppes", "cappy",
  "limonada", "prigat", "nestea",
];

/**
 * The one drink that goes into the basket when a drink is wanted: the cheapest
 * soft drink of a normal size (not an espresso, not water if a soda exists).
 */
export function pickDrink(drinks: MenuItem[]): MenuItem | null {
  if (drinks.length === 0) return null;
  const isSoda = (d: MenuItem) => normalize(d.name).split(" ").some((t) => SODA_WORDS.includes(t));
  const normalSize = drinks.filter((d) => (d.grams as number) >= 250);
  const sodas = normalSize.filter(isSoda);
  const pool = sodas.length > 0 ? sodas : normalSize.length > 0 ? normalSize : drinks;
  return [...pool].sort((a, b) => a.price - b.price || (b.grams as number) - (a.grams as number))[0];
}

/** The cheapest sauce: the one added when a sauce is wanted. */
export function pickSauce(sauces: MenuItem[]): MenuItem | null {
  if (sauces.length === 0) return null;
  // Salad dressings are sauces too, but not what goes with a burger and fries.
  const dressing = (s: MenuItem) => Number(/vinaigrette|dressing|iaurt|insule/.test(normalize(s.name)));
  return [...sauces].sort(
    (a, b) => dressing(a) - dressing(b) || a.price - b.price || (b.grams as number) - (a.grams as number),
  )[0];
}

/**
 * Of several products that could fulfil the same wish, the ones worth trying:
 * not both dearer and lighter than another one.
 */
function undominated(list: MenuItem[]): MenuItem[] {
  const g = (it: MenuItem) => (it.grams as number) * (it.unitsPerPurchase ?? 1);
  return list.filter(
    (a) => !list.some((b) => b !== a && b.price <= a.price && g(b) >= g(a) && (b.price < a.price || g(b) > g(a))),
  );
}

const FLAVOUR_WORDS = new Set(["picant", "picanta", "nepicant", "nepicanta", "spicy", "hot", "classic", "clasic", "non"]);
/** The name without what only tells the flavour apart ("Twister Picant" / "Twister Nepicant"). */
const family = (name: string) =>
  normalize(name)
    .split(" ")
    .filter((t) => !FLAVOUR_WORDS.has(t))
    .join(" ");

/** Drinks and sauces are paid for but are not "food" in the grams total. */
const countsAsFood = (kind: MenuItem["kind"]) => kind !== "drink" && kind !== "sauce";

/**
 * Products bought up front so the basket has the fries and/or the drink that
 * were asked for: either on their own or as a combo that brings them along.
 */
interface Prefix {
  items: MenuItem[];
  price: Bani;
  /** Food grams only (a drink does not count). */
  grams: number;
  hasMain: boolean;
  /** Free main-dish credits the rest of the basket must leave for these fries. */
  credits: number;
}

function toLine(it: MenuItem, qty: number): BasketLine {
  const upp = it.unitsPerPurchase ?? 1;
  return {
    itemId: it.id,
    name: it.name,
    qty,
    units: qty * upp,
    unitGrams: it.grams as number,
    price: it.price,
    originalPrice: it.originalPrice,
    lineTotal: qty * it.price,
    lineGrams: qty * upp * (it.grams as number),
    kind: it.kind,
    includes: it.includes,
    weightUncertain: it.weightUncertain,
    weightSource: it.weightSource,
  };
}

function optimizeCore(
  allItems: MenuItem[],
  fees: FeeRules,
  offers: Offer[],
  opts: OptimizeOptions,
): OptimizeResult {
  // One extra per main dish, unless sides are explicitly unlimited ("any").
  // The rule does not depend on fries being wanted: with sides off, salads
  // and desserts (when allowed) still need a main dish each.
  const balanced = (opts.sides ?? "balanced") !== "any";
  // "Extras" need a main dish to go with: sides, salads, desserts. Mains come
  // first so their credits exist by the time the extras are added.
  const isExtra = (it: MenuItem) => balanced && it.kind !== "food";
  // Fries asked for explicitly stay available even when other sides are off.
  // The same product listed in two categories, or in a hot and a mild version at
  // the same price and weight, is one product: otherwise the per-item limit
  // would allow it twice over. The first one listed stands for both.
  const listed = new Set<string>();
  const eligible = eligibleItems(
    allItems,
    opts.wantFries ? { ...opts, sides: opts.sides === "none" ? "balanced" : opts.sides } : opts,
  ).filter((it) => {
    const k = `${family(it.name)}|${it.price}|${it.grams}|${it.unitsPerPurchase ?? 1}`;
    return !listed.has(k) && !!listed.add(k);
  });
  const sidesOff = opts.sides === "none";
  // Drinks, sauces, salads and desserts never fill the basket: at most the one that was asked for.
  const single = (kind: MenuItem["kind"]) => kind === "drink" || kind === "sauce" || kind === "salad" || kind === "dessert";
  const items = eligible
    .filter((it) => !single(it.kind) && !(sidesOff && it.kind === "side"))
    .sort((a, b) => Number(isExtra(a)) - Number(isExtra(b)));
  if (items.length === 0) {
    return { best: null, stretch: null, reason: "Niciun produs cu gramaj cunoscut." };
  }
  if (balanced && !items.some((it) => !isExtra(it))) {
    return { best: null, stretch: null, reason: "Niciun fel principal cu gramaj cunoscut." };
  }

  // ---- what has to be in the basket ----
  const mains = eligible.filter((it) => it.kind === "food");
  const drink = opts.includeDrinks ? pickDrink(eligible.filter((it) => it.kind === "drink")) : null;
  const sauce = opts.includeSauces ? pickSauce(eligible.filter((it) => it.kind === "sauce")) : null;
  const friesItems = opts.wantFries ? eligible.filter((it) => it.kind === "side" && isFries(it.name)) : [];
  const salads = opts.wantSalad ? undominated(eligible.filter((it) => it.kind === "salad")) : [];
  const desserts = opts.wantDessert ? undominated(eligible.filter((it) => it.kind === "dessert")) : [];
  const brings = (part: "fries" | "drink" | "sauce") => mains.some((it) => it.includes?.[part]);
  // A wish only binds when the restaurant can fulfil it at all.
  const need = {
    fries: !!opts.wantFries && (friesItems.length > 0 || brings("fries")),
    drink: opts.includeDrinks && (drink != null || brings("drink")),
    sauce: opts.includeSauces && (sauce != null || brings("sauce")),
  };

  const mk = (list: MenuItem[]): Prefix => {
    const hasMain = list.some((it) => it.kind === "food");
    return {
      items: list,
      price: list.reduce((a, it) => a + it.price, 0),
      grams: list.reduce((a, it) => a + (countsAsFood(it.kind) ? (it.grams as number) * (it.unitsPerPurchase ?? 1) : 0), 0),
      hasMain,
      // A combo in the prefix pays for the fries bought with it.
      credits: balanced && !hasMain && list.some((it) => it.kind === "side") ? 1 : 0,
    };
  };
  // Each prefix is: optionally one main dish that brings some of the wanted
  // parts along (a combo), plus the missing parts bought on their own.
  const prefixes: Prefix[] = [];
  const wanted = need.fries || need.drink || need.sauce;
  const carriers: (MenuItem | null)[] = [null];
  if (wanted) {
    for (const c of mains) {
      const inc = c.includes;
      if (inc && ((need.fries && inc.fries) || (need.drink && inc.drink) || (need.sauce && inc.sauce))) carriers.push(c);
    }
  }
  for (const c of carriers) {
    const base: MenuItem[] = c ? [c] : [];
    if (need.drink && !c?.includes?.drink) {
      if (!drink) continue;
      base.push(drink);
    }
    if (need.sauce && !c?.includes?.sauce) {
      if (!sauce) continue;
      base.push(sauce);
    }
    // One of each remaining wish; every candidate product gives its own prefix.
    let variants: MenuItem[][] = [base];
    const oneOf = (choices: MenuItem[]) => {
      variants = variants.flatMap((v) => choices.map((o) => [...v, o]));
    };
    if (need.fries && !c?.includes?.fries) oneOf(friesItems);
    if (salads.length > 0) oneOf(salads);
    if (desserts.length > 0) oneOf(desserts);
    for (const v of variants) prefixes.push(mk(v));
  }
  if (prefixes.length === 0) prefixes.push(mk([]));

  const limit =
    opts.mode === "flex" ? Math.floor(opts.budget * (1 + opts.tolerancePct / 100)) : opts.budget;
  // Cart discounts can make the subtotal larger than the counted amount, so
  // leave headroom; computeCost decides what is actually affordable.
  const maxDiscPct = Math.max(0, ...offers.map((o) => (o.kind === "percent" ? o.pct : 0)));
  const maxDiscAmt = Math.max(0, ...offers.map((o) => (o.kind === "amount" ? o.amount : 0)));
  const S = Math.min(
    Math.ceil(limit / (1 - Math.min(maxDiscPct, 90) / 100)) + maxDiscAmt,
    limit * 10,
  );
  if (S <= 0) return { best: null, stretch: null, reason: "Buget prea mic." };

  const cap = Math.max(1, Math.min(opts.maxPerItem, 31));

  // Credits: every main dish bought allows one extra. C = most credits tracked
  // (so at most C extras per basket); 0 switches the rule off.
  const C = balanced ? (S > 20000 ? 3 : 6) : 0;
  const W = S + 1;
  const R = Math.min(1, C);

  interface Tables {
    /** bestAt[r][s] = max grams with subtotal exactly s and at least r unused credits (-1 = unreachable). */
    bestAt: Float64Array[];
    levelAt: Uint8Array[];
    /** Per item: purchases (low 5 bits) and the credit level we came from (high 3 bits). */
    taken: Uint8Array[];
  }

  /**
   * The knapsack over `items`. Products in `held` are already in the basket
   * once (as part of a prefix), so one purchase fewer is allowed for them.
   */
  const runDp = (held: Set<MenuItem>): Tables => {
    // best[c * W + s] = max grams with subtotal exactly s and c unused credits.
    let best = new Float64Array((C + 1) * W).fill(-1);
    best[0] = 0;
    const taken: Uint8Array[] = [];

    for (const it of items) {
      const g = (it.grams as number) * (it.unitsPerPurchase ?? 1);
      const p = it.price;
      const extra = isExtra(it);
      // A combo that comes with fries has its side already: it allows no further one.
      const bringsSide = !!it.includes?.fries;
      const itemCap = held.has(it) ? cap - 1 : cap;
      const next = best.slice();
      const take = new Uint8Array((C + 1) * W);
      for (let c = 0; c <= C; c++) {
        for (let k = 1; k <= itemCap && k * p <= S; k++) {
          let target: number;
          if (C === 0) target = 0;
          else if (extra) target = c - k;
          else target = Math.min(C, c + (bringsSide ? 0 : k));
          if (target < 0) break;
          const from = c * W;
          const to = target * W;
          const cost = k * p;
          const gain = k * g;
          for (let s = cost; s <= S; s++) {
            const prev = best[from + s - cost];
            if (prev < 0) continue;
            const v = prev + gain;
            if (v > next[to + s]) {
              next[to + s] = v;
              take[to + s] = k | (c << 5);
            }
          }
        }
      }
      best = next;
      taken.push(take);
    }

    // Collapse the credit dimension: for each subtotal keep the best level that
    // still has at least r credits left (r = 0 or 1).
    const bestAt: Float64Array[] = [];
    const levelAt: Uint8Array[] = [];
    for (let r = 0; r <= R; r++) {
      const b = new Float64Array(W).fill(-1);
      const l = new Uint8Array(W);
      for (let c = r; c <= C; c++) {
        for (let s = 0; s <= S; s++) {
          const v = best[c * W + s];
          if (v > b[s]) {
            b[s] = v;
            l[s] = c;
          }
        }
      }
      bestAt.push(b);
      levelAt.push(l);
    }
    return { bestAt, levelAt, taken };
  };

  interface Choice {
    prefix: Prefix;
    s: number;
    tables: Tables;
    grams: number;
    counted: number;
  }

  /** What the knapsack bought for this choice (the prefix not included). */
  const bought = ({ prefix, s, tables }: Choice): Map<MenuItem, number> => {
    const qty = new Map<MenuItem, number>();
    let rem = s;
    let level = tables.levelAt[Math.min(prefix.credits, R)][s];
    for (let i = items.length - 1; i >= 0; i--) {
      const packed = tables.taken[i][level * W + rem];
      const k = packed & 31;
      if (k > 0) {
        level = packed >> 5;
        qty.set(items[i], k);
        rem -= k * items[i].price;
      }
    }
    return qty;
  };

  const build = (choice: Choice): Basket => {
    const qty = bought(choice);
    for (const it of choice.prefix.items) qty.set(it, (qty.get(it) ?? 0) + 1);
    const lines = [...qty].map(([it, k]) => toLine(it, k));
    const rank = (l: BasketLine) => ({ food: 0, side: 1, other: 1, salad: 2, dessert: 3, sauce: 4, drink: 5 })[l.kind];
    lines.sort((a, b) => rank(a) - rank(b) || b.lineGrams - a.lineGrams);
    const grams = lines.reduce((a, l) => a + (countsAsFood(l.kind) ? l.lineGrams : 0), 0);
    const cost = computeCost(choice.s + choice.prefix.price, fees, offers, opts.scope);
    return { lines, grams, cost, leiPer100g: grams > 0 ? cost.counted / grams : 0, protein: 0, proteinEstimated: false, score: grams };
  };

  // For one prefix: the subtotal with most grams whose counted cost fits; ties -> cheaper.
  const pickIn = (tables: Tables, prefix: Prefix, maxCounted: number, minGramsExclusive: number): Choice | null => {
    let found: Choice | null = null;
    let bestG = minGramsExclusive;
    let bestC = Infinity;
    const table = tables.bestAt[Math.min(prefix.credits, R)];
    // The prefix alone is a valid order when it holds a main dish (or the
    // one-extra-per-main rule is off); otherwise something must be added.
    const sMin = prefix.items.length > 0 && (prefix.hasMain || !balanced) ? 0 : 1;
    for (let s = Math.max(sMin, fees.minOrder - prefix.price); s <= S; s++) {
      if (table[s] < 0) continue;
      const g = table[s] + prefix.grams;
      if (g < bestG) continue;
      const c = computeCost(s + prefix.price, fees, offers, opts.scope).counted;
      if (c > maxCounted) continue;
      if (g > bestG || c < bestC) {
        found = { prefix, s, tables, grams: g, counted: c };
        bestG = g;
        bestC = c;
      }
    }
    return found;
  };

  const base = runDp(new Set());
  const inKnapsack = new Set(items);
  const better = (a: Choice, b: Choice | null) =>
    !b || a.grams > b.grams || (a.grams === b.grams && a.counted < b.counted);
  /** Extra knapsack runs allowed per search, to keep big budgets fast. */
  const MAX_RERUNS = 6;

  // The shared knapsack does not know what the prefix holds, so its answer can
  // go one over the per-item cap. Prefixes are tried best-first; one whose
  // answer breaks the cap gets its own run with the cap lowered for its items.
  const pick = (maxCounted: number, minGramsExclusive: number): Choice | null => {
    const relaxed = prefixes
      .map((p) => pickIn(base, p, maxCounted, minGramsExclusive))
      .filter((c): c is Choice => c != null)
      .sort((a, b) => b.grams - a.grams || a.counted - b.counted);
    let found: Choice | null = null;
    let reruns = 0;
    for (const cand of relaxed) {
      // A relaxed answer is an upper bound: nothing further down can win.
      if (found && !better(cand, found)) break;
      const held = cand.prefix.items.filter((it) => inKnapsack.has(it));
      const qty = held.length > 0 ? bought(cand) : null;
      if (!qty || held.every((it) => (qty.get(it) ?? 0) < cap)) {
        found = cand;
        break;
      }
      if (reruns >= MAX_RERUNS) continue;
      reruns++;
      const exact = pickIn(runDp(new Set(held)), cand.prefix, maxCounted, minGramsExclusive);
      if (exact && better(exact, found)) found = exact;
    }
    return found;
  };

  const chosen = pick(opts.budget, 0);
  const bestBasket = chosen ? build(chosen) : null;

  let stretch: Basket | null = null;
  if (opts.mode === "flex") {
    const more = pick(limit, (bestBasket?.grams ?? 0) + 1e-9);
    if (more) stretch = build(more);
  }

  let reason: string | undefined;
  if (!bestBasket) {
    reason =
      fees.minOrder > opts.budget
        ? `Comanda minimă (${(fees.minOrder / 100).toFixed(2)} lei) depășește bugetul.`
        : "Nu încape nimic în buget după taxe.";
  }
  return { best: bestBasket, stretch, reason };
}


/** Fills in protein, and the real grams when the search maximized protein instead. */
function describe(b: Basket | null, byId: Map<string, MenuItem>, objective: Objective): Basket | null {
  if (!b) return b;
  let grams = 0;
  let protein = 0;
  let estimated = false;
  const lines = b.lines.map((l) => {
    const it = byId.get(l.itemId);
    if (!it) return l;
    const upp = it.unitsPerPurchase ?? 1;
    const real = { ...l, unitGrams: it.grams as number, lineGrams: l.qty * upp * (it.grams as number) };
    if (countsAsFood(l.kind)) {
      grams += real.lineGrams;
      const p = proteinOf(it);
      protein += l.qty * upp * p.grams;
      if (p.estimated) estimated = true;
    }
    return real;
  });
  return {
    ...b,
    lines,
    grams,
    protein,
    proteinEstimated: estimated,
    leiPer100g: grams > 0 ? b.cost.counted / grams : 0,
    score: objective === "protein" ? protein : grams,
  };
}

export function optimize(allItems: MenuItem[], fees: FeeRules, offers: Offer[], opts: OptimizeOptions): OptimizeResult {
  const objective = opts.objective ?? "grams";
  const byId = new Map(allItems.map((it) => [it.id, it]));
  // To maximize protein, the search runs on the same products with protein in
  // place of grams (drinks and sauces keep their grams: they are not counted).
  const items =
    objective === "protein"
      ? allItems.map((it) => (it.grams != null && countsAsFood(it.kind) ? { ...it, grams: proteinOf(it).grams } : it))
      : allItems;
  const r = optimizeCore(items, fees, offers, opts);
  return { ...r, best: describe(r.best, byId, objective), stretch: describe(r.stretch, byId, objective) };
}

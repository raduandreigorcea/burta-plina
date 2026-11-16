import { cached } from "./cache";
import { eligibleItems, isGuessed, optimize } from "./optimizer";
import { adapters } from "./platforms";
import type { MenuItem, OptimizeOptions, OptimizeResult, PlatformId, PlatformMenu, Venue } from "./types";
import { baseName, normalize } from "./weight";

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export interface PlatformSearch {
  platform: PlatformId;
  venues: Venue[];
  error?: string;
}

/** Venues whose name contains the query come first, then by distance. */
function rankVenues(venues: Venue[], q: string): Venue[] {
  const nq = normalize(q).replace(/ /g, "");
  const matches = (v: Venue) => normalize(v.name).replace(/ /g, "").includes(nq);
  return [...venues].sort((a, b) => {
    const ma = matches(a) ? 0 : 1;
    const mb = matches(b) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    return (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9);
  });
}

export async function searchAll(q: string, lat: number, lon: number): Promise<PlatformSearch[]> {
  return Promise.all(
    adapters.map(async (ad): Promise<PlatformSearch> => {
      try {
        const venues = await cached(`search:${ad.id}:${normalize(q)}:${round4(lat)}:${round4(lon)}`, () =>
          ad.searchVenues(q, lat, lon),
        );
        return { platform: ad.id, venues: rankVenues(venues, q).slice(0, 15) };
      } catch (e) {
        return { platform: ad.id, venues: [], error: (e as Error).message };
      }
    }),
  );
}

export interface PlatformOutcome {
  platform: PlatformId;
  venue: Venue;
  error?: string;
  result?: OptimizeResult;
  offers?: string[];
  notes?: string[];
  stats?: { items: number; usable: number; borrowedWeights: number };
  /** Items skipped because their weight is unknown. */
  missingWeight?: string[];
}

/**
 * Fills unknown weights with the weight the same product has on another
 * platform (matched by base name). Returns new items; inputs are not mutated.
 */
export function borrowWeights(menus: MenuItem[][]): { items: MenuItem[]; borrowed: number }[] {
  const known = new Map<string, number | null>();
  for (const items of menus) {
    for (const it of items) {
      if (it.grams == null || it.weightUncertain) continue;
      const key = baseName(it.name);
      if (key.length < 3) continue;
      const prev = known.get(key);
      // The same name with different weights (sizes) is ambiguous: do not use it.
      if (prev === undefined) known.set(key, it.grams);
      else if (prev !== it.grams) known.set(key, null);
    }
  }
  return menus.map((items) => {
    let borrowed = 0;
    const out = items.map((it) => {
      if (it.grams != null) return it;
      const g = known.get(baseName(it.name));
      if (g == null) return it;
      borrowed++;
      return { ...it, grams: g, weightSource: "other-platform" as const, weightUncertain: true };
    });
    return { items: out, borrowed };
  });
}

const MENU_WORDS = new Set(["meniu", "menu", "maxi", "mare", "mediu", "mic"]);
const comboTokens = (name: string) =>
  normalize(name.split(",")[0])
    .split(" ")
    .map((t) => (t === "bucati" || t === "bucata" ? "buc" : t))
    .filter((t) => t && !/^\d+(g|gr|ml)$/.test(t) && t !== "gr" && t !== "g");

/**
 * Combos listed without a weight ("Meniu Maxi Big Mac"): the sandwich plus the
 * fries that come with it, both taken from the same menu. The drink is left
 * out. Only fills an item when exactly one sandwich matches.
 */
export function deriveComboWeights(items: MenuItem[]): { items: MenuItem[]; derived: number } {
  const known = items.filter((i) => i.grams != null && !i.weightUncertain && i.kind === "food");
  const fries = (size: string) =>
    items.find((i) => {
      const t = comboTokens(i.name);
      return i.grams != null && t[0] === "cartofi" && t.includes("prajiti") && t.includes(size);
    })?.grams ?? null;
  let derived = 0;
  const out = items.map((it) => {
    if (it.grams != null) return it;
    const all = comboTokens(it.name);
    if (!all.includes("meniu") && !all.includes("menu")) return it;
    const size = all.includes("maxi") || all.includes("mare") ? "mare" : "medie";
    const want = new Set(all.filter((t) => !MENU_WORDS.has(t)));
    if (want.size === 0) return it;
    let bestLen = 0;
    let match: number[] = [];
    for (const k of known) {
      const t = comboTokens(k.name).filter((x) => !MENU_WORDS.has(x));
      if (t.length === 0 || !t.every((x) => want.has(x))) continue;
      if (t.length > bestLen) {
        bestLen = t.length;
        match = [k.grams as number];
      } else if (t.length === bestLen) match.push(k.grams as number);
    }
    const side = fries(size);
    // The sandwich must cover the whole combo name, and be unambiguous.
    if (bestLen < want.size || new Set(match).size !== 1 || side == null) return it;
    derived++;
    return {
      ...it,
      grams: match[0] + side,
      weightSource: "derived" as const,
      weightUncertain: true,
      // Assumed: such a menu is the sandwich with fries and a drink.
      includes: { fries: true, drink: true },
    };
  });
  const res = sandwichOnlyMenus(out, fries, derived);
  return { items: glazedPieces(res.items), derived: res.derived };
}

const FLAVOUR_WORDS = new Set(["classic", "clasic", "spicy", "picant", "picante", "nepicant", "nepicante", "hot"]);

/**
 * "5 buc. Fillet Nuggets" (100 g) and "5 buc. Voodoo Fillet Nuggets" (200 g) are
 * the same five pieces; the difference is glaze. The glazed one counts as the plain one.
 */
function glazedPieces(items: MenuItem[]): MenuItem[] {
  const parse = (it: MenuItem) => {
    const t = comboTokens(it.name);
    if (!/^\d+$/.test(t[0] ?? "")) return null;
    const words = t.slice(1).filter((w) => w !== "buc" && w !== "pc" && w !== "pcs" && !FLAVOUR_WORDS.has(w));
    return words.length > 0 ? { count: t[0], words } : null;
  };
  const plain = items
    .filter((it) => it.kind === "food" && it.grams != null && !it.weightUncertain)
    .map((it) => ({ it, p: parse(it) }))
    .filter((x): x is { it: MenuItem; p: { count: string; words: string[] } } => x.p != null);
  return items.map((it) => {
    if (it.kind !== "food" || it.grams == null) return it;
    const p = parse(it);
    if (!p) return it;
    let grams = it.grams;
    for (const b of plain) {
      if (b.p.count !== p.count || b.p.words.length >= p.words.length) continue;
      if (b.p.words.every((w) => p.words.includes(w))) grams = Math.min(grams, b.it.grams as number);
    }
    return grams < it.grams ? { ...it, grams, weightSource: "derived" as const, weightUncertain: true } : it;
  });
}

/**
 * The other way round: menus described only by their sandwich ("Meniu Whopper
 * ... Porție (270g)", nothing about the fries). The weight is the sandwich's, so
 * the sandwich sold alone gets it when it has none, and the menu gets its fries added.
 */
function sandwichOnlyMenus(
  items: MenuItem[],
  fries: (size: string) => number | null,
  derived: number,
): { items: MenuItem[]; derived: number } {
  const key = (name: string) =>
    comboTokens(name)
      .filter((t) => !MENU_WORDS.has(t))
      .sort()
      .join(" ");
  const isMenu = (it: MenuItem) => comboTokens(it.name).some((t) => t === "meniu" || t === "menu");
  const menus = items.filter(
    (it) =>
      it.kind === "food" &&
      it.grams != null &&
      !it.weightUncertain &&
      it.weightSource === "description" &&
      !it.includes?.fries &&
      isMenu(it),
  );
  if (menus.length === 0) return { items, derived };
  const sandwich = new Map<string, number | null>();
  for (const m of menus) {
    const k = key(m.name);
    if (!k) continue;
    // Two menus of the same sandwich with different weights: ambiguous.
    sandwich.set(k, sandwich.has(k) && sandwich.get(k) !== m.grams ? null : m.grams);
  }
  const asMenu = new Set(menus);
  const out = items.map((it) => {
    if (asMenu.has(it)) {
      const t = comboTokens(it.name);
      const side = fries(t.includes("maxi") || t.includes("mare") ? "mare" : "medie");
      if (side == null) return it;
      derived++;
      return {
        ...it,
        grams: (it.grams as number) + side,
        weightSource: "derived" as const,
        weightUncertain: true,
        includes: { ...it.includes, fries: true, drink: true },
      };
    }
    if (it.grams != null || it.kind !== "food" || isMenu(it)) return it;
    const g = sandwich.get(key(it.name));
    if (g == null) return it;
    return { ...it, grams: g, weightSource: "derived" as const, weightUncertain: true };
  });
  return { items: out, derived };
}

export async function optimizeAll(
  venues: Venue[],
  lat: number,
  lon: number,
  opts: OptimizeOptions,
): Promise<PlatformOutcome[]> {
  const loaded = await Promise.all(
    venues.map(async (venue): Promise<{ venue: Venue; menu?: PlatformMenu; error?: string }> => {
      const ad = adapters.find((a) => a.id === venue.platform);
      if (!ad) return { venue, error: "Platformă necunoscută." };
      try {
        const menu = await cached(`menu:${ad.id}:${venue.id}:${round4(lat)}:${round4(lon)}`, () =>
          ad.getMenu(venue, lat, lon),
        );
        return { venue, menu };
      } catch (e) {
        return { venue, error: (e as Error).message };
      }
    }),
  );

  const ok = loaded.filter((l) => l.menu);
  const combos = ok.map((l) => deriveComboWeights(l.menu!.items));
  const filled = borrowWeights(combos.map((c) => c.items));

  const outcomes = loaded.map((l): PlatformOutcome => {
    if (!l.menu) return { platform: l.venue.platform, venue: l.venue, error: l.error };
    const { items, borrowed } = filled[ok.indexOf(l)];
    const derived = combos[ok.indexOf(l)].derived;
    const result = optimize(items, l.menu.fees, l.menu.offers, opts);
    const missing = items.filter(
      (i) =>
        (i.grams == null || (!opts.includeGuessed && isGuessed(i))) &&
        (i.kind !== "side" || (opts.sides ?? "balanced") !== "none") &&
        (i.kind !== "other" || !!opts.includeOther) &&
        (i.kind !== "salad" || !!opts.wantSalad) &&
        (i.kind !== "dessert" || !!opts.wantDessert) &&
        i.kind !== "drink" &&
        i.kind !== "sauce",
    );
    const notes = [...l.menu.fees.notes];
    if (derived > 0) {
      notes.push(
        `La ${derived} meniuri am presupus sandviș + cartofi + băutură; gramajul e sandvișul plus cartofii (marcate cu ~).`,
      );
    }
    if (borrowed > 0) {
      notes.push(`${borrowed} produse au gramajul preluat de pe altă platformă (marcate cu ~).`);
    }
    return {
      platform: l.venue.platform,
      venue: l.venue,
      result,
      offers: l.menu.offers.map((o) => o.label),
      notes,
      stats: { items: items.length, usable: eligibleItems(items, opts).length, borrowedWeights: borrowed },
      missingWeight: missing.map((i) => i.name),
    };
  });

  // Most food first; ties -> cheaper; failures last.
  return outcomes.sort((a, b) => {
    const ga = a.result?.best?.grams ?? -1;
    const gb = b.result?.best?.grams ?? -1;
    if (ga !== gb) return gb - ga;
    return (a.result?.best?.cost.counted ?? 0) - (b.result?.best?.cost.counted ?? 0);
  });
}

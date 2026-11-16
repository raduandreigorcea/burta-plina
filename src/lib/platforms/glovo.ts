import { cached } from "../cache";
import type { FeeRules, Offer, PlatformAdapter, PlatformMenu, Venue } from "../types";
import { normalize } from "../weight";
import { enrichItem, type RawItem } from "./enrich";
import { haversineM } from "./http";

// Glovo has no public JSON API. Everything here is read from the public,
// server-rendered pages of glovoapp.com (verified 2026-11): the data sits in
// the Next.js flight payload embedded in the HTML.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BASE = "https://glovoapp.com/ro/ro";

/** Glovo works per city; pick the closest one to the delivery address. */
const CITIES: { slug: string; lat: number; lon: number }[] = [
  { slug: "bucharest", lat: 44.4268, lon: 26.1025 },
  { slug: "cluj-napoca", lat: 46.7712, lon: 23.6236 },
  { slug: "timisoara", lat: 45.7489, lon: 21.2087 },
  { slug: "iasi", lat: 47.1585, lon: 27.6014 },
  { slug: "constanta", lat: 44.1598, lon: 28.6348 },
  { slug: "craiova", lat: 44.3302, lon: 23.7949 },
  { slug: "brasov", lat: 45.6427, lon: 25.5887 },
  { slug: "galati", lat: 45.4353, lon: 28.008 },
  { slug: "ploiesti", lat: 44.9367, lon: 26.0129 },
  { slug: "oradea", lat: 47.0465, lon: 21.9189 },
  { slug: "braila", lat: 45.2692, lon: 27.9575 },
  { slug: "arad", lat: 46.1866, lon: 21.3123 },
  { slug: "pitesti", lat: 44.8565, lon: 24.8692 },
  { slug: "sibiu", lat: 45.7983, lon: 24.1256 },
  { slug: "bacau", lat: 46.5671, lon: 26.9146 },
  { slug: "targu-mures", lat: 46.5386, lon: 24.5514 },
  { slug: "baia-mare", lat: 47.6567, lon: 23.585 },
  { slug: "buzau", lat: 45.15, lon: 26.8333 },
  { slug: "botosani", lat: 47.7487, lon: 26.6694 },
  { slug: "satu-mare", lat: 47.7926, lon: 22.8853 },
  { slug: "ramnicu-valcea", lat: 45.0997, lon: 24.3693 },
  { slug: "suceava", lat: 47.6635, lon: 26.2732 },
  { slug: "piatra-neamt", lat: 46.9275, lon: 26.3708 },
  { slug: "targu-jiu", lat: 45.0378, lon: 23.2749 },
  { slug: "targoviste", lat: 44.9254, lon: 25.4567 },
  { slug: "focsani", lat: 45.6965, lon: 27.1865 },
  { slug: "bistrita", lat: 47.1357, lon: 24.5 },
  { slug: "alba-iulia", lat: 46.0733, lon: 23.5805 },
  { slug: "deva", lat: 45.8833, lon: 22.9 },
  { slug: "tulcea", lat: 45.1787, lon: 28.8052 },
];

export function nearestCity(lat: number, lon: number): { slug: string; distanceM: number } {
  let best = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = haversineM(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return { slug: best.slug, distanceM: bestD };
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html", "accept-language": "ro" },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`glovoapp.com a răspuns cu ${res.status}`);
  return res.text();
}

/** Concatenates the Next.js flight chunks embedded in a page. */
export function extractFlight(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      out += JSON.parse(m[1]) as string;
    } catch {
      // skip a malformed chunk
    }
  }
  return out;
}

/** Returns the JSON object literal starting at s[start] === "{". */
function objectAt(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

function parseAt<T>(s: string, start: number): T | null {
  const raw = objectAt(s, start);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------- store list (category pages) ----------

interface GEntry {
  id: string;
  slug: string;
  title: string;
  distance?: string;
  availability?: { status?: string };
}

export function parseGlovoStoreList(html: string): { entries: GEntry[]; types: string[] } {
  const flight = extractFlight(html);
  const i = flight.indexOf('"stores":{"pagination"');
  const stores = i >= 0 ? parseAt<{ entries?: GEntry[] }>(flight, flight.indexOf("{", i + 8)) : null;
  const types = [...new Set([...html.matchAll(/[?&](?:amp;)?type=([a-z0-9-]+_\d+)/g)].map((m) => m[1]))];
  return { entries: (stores?.entries ?? []).filter((e) => e.slug && e.title), types };
}

/** "<100m", "1,2 km" -> metres */
function parseDistance(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.replace(",", ".").match(/([\d.]+)\s*(km|m)/i);
  if (!m) return undefined;
  return Math.round(parseFloat(m[1]) * (m[2].toLowerCase() === "km" ? 1000 : 1));
}

// Filter pages most likely to contain fast-food chains; tried before the rest.
const PRIORITY_TYPES = ["fast-food", "burgeri", "pizza", "shaorma", "kebab", "pui", "sandviciuri", "americana"];

async function cityIndex(city: string, phase: "priority" | "all"): Promise<GEntry[]> {
  const main = await cached(`glovo:list:${city}:main`, async () =>
    parseGlovoStoreList(await fetchPage(`${BASE}/${city}/categories/mancare_1`)),
  );
  const isPriority = (t: string) => PRIORITY_TYPES.includes(t.replace(/_\d+$/, ""));
  const wanted = main.types.filter((t) => (phase === "priority" ? isPriority(t) : !isPriority(t)));
  const lists = await Promise.all(
    wanted.map((t) =>
      cached(
        `glovo:list:${city}:${t}`,
        async () => {
          try {
            return parseGlovoStoreList(await fetchPage(`${BASE}/${city}/categories/mancare_1?type=${t}`)).entries;
          } catch {
            return [] as GEntry[];
          }
        },
        6 * 60 * 60 * 1000,
      ),
    ),
  );
  const seen = new Map<string, GEntry>();
  for (const e of [...(phase === "priority" ? main.entries : []), ...lists.flat()]) {
    if (!seen.has(e.slug)) seen.set(e.slug, e);
  }
  return [...seen.values()];
}

// ---------- store page ----------

interface GAttributeGroup {
  min?: number;
  attributes?: { priceImpact?: number }[];
}
interface GProduct {
  id: number | string;
  name: string;
  description?: string | null;
  price: number;
  promotions?: { type?: string; price?: number; isPrime?: boolean; title?: string }[];
  attributeGroups?: GAttributeGroup[];
}
interface GList {
  title?: string;
  slug?: string;
  elements?: { type?: string; data?: GProduct }[];
}
interface GStore {
  id: number;
  name: string;
  slug: string;
  open?: boolean;
  deliveryFeeInfo?: { fee?: number } | null;
  serviceFee?: number | null;
  promotions?: { title?: string; description?: string; type?: string }[];
}

const toBani = (lei: number) => Math.round(lei * 100);

/**
 * What Glovo adds at checkout, as its own "How do we calculate fees?" panel
 * states it (Bucharest, 2026-11): services are 10% of the order, at least 1.99
 * and at most 10.99 lei; an order below 40 lei pays 5.99 lei more. The public
 * store page does not give these (its "serviceFee" just repeats the delivery fee).
 */
const GLOVO_BASKET_FEES = {
  serviceFee: { pct: 10, min: 199, max: 1099 },
  smallOrder: { threshold: 4000, mode: "flat" as const, flat: 599 },
};

export function parseGlovoStorePage(html: string): (PlatformMenu & { storeName: string }) | null {
  const flight = extractFlight(html);
  const si = flight.indexOf('"store":{"id":');
  const store = si >= 0 ? parseAt<GStore>(flight, flight.indexOf("{", si + 7)) : null;
  if (!store) return null;

  // Long texts are sent as separate rows ("56:T1a2,<text>") and referenced as "$56".
  const texts = new Map<string, string>();
  const textRow = /([0-9a-f]+):T([0-9a-f]+),/y;
  for (const m of flight.matchAll(/(?:^|\n)(?=[0-9a-f]+:T[0-9a-f]+,)/g)) {
    // A text row has no newline after it: the next row starts right where it ends.
    textRow.lastIndex = m.index + m[0].length;
    for (let row = textRow.exec(flight); row; row = textRow.exec(flight)) {
      const bytes = parseInt(row[2], 16);
      const start = textRow.lastIndex;
      // The length is in UTF-8 bytes, which is never less than the number of characters.
      const value = Buffer.from(flight.slice(start, start + bytes), "utf8").subarray(0, bytes).toString("utf8");
      texts.set(row[1], value);
      textRow.lastIndex = start + value.length;
    }
  }
  const text = (v?: string | null) => {
    const ref = v?.match(/^\$([0-9a-f]+)$/);
    return ref ? (texts.get(ref[1]) ?? "") : v;
  };

  const byId = new Map<string, RawItem & { fromPromoList: boolean }>();
  for (const m of flight.matchAll(/\{"type":"LIST","data":/g)) {
    const list = parseAt<{ data: GList }>(flight, m.index)?.data;
    if (!list?.elements) continue;
    // "Promoții" / "Cele mai vândute" repeat products from the real categories.
    const generic = /-(pr|ts)$/.test(list.slug ?? "");
    for (const el of list.elements) {
      const p = el.data;
      if (!el.type?.startsWith("PRODUCT") || !p || typeof p.price !== "number") continue;
      const id = String(p.id);
      const existing = byId.get(id);
      if (existing) {
        if (existing.fromPromoList && !generic) {
          existing.category = list.title ?? "";
          existing.fromPromoList = false;
        }
        continue;
      }
      // Mandatory choices (packaging etc.): assume the cheapest ones.
      let extra = 0;
      for (const g of p.attributeGroups ?? []) {
        const min = g.min ?? 0;
        if (min < 1) continue;
        const impacts = (g.attributes ?? []).map((a) => a.priceImpact ?? 0).sort((a, b) => a - b);
        for (let k = 0; k < min && k < impacts.length; k++) extra += impacts[k];
      }
      let price = p.price;
      let units = 1;
      for (const promo of p.promotions ?? []) {
        if (promo.isPrime) continue; // Glovo Prime subscribers only
        if (typeof promo.price === "number" && promo.price > 0 && promo.price < price) price = promo.price;
        if (/TWO_FOR_ONE|2X1|2_FOR_1/i.test(promo.type ?? "")) units = 2;
      }
      byId.set(id, {
        id,
        name: p.name,
        description: text(p.description),
        category: list.title ?? "",
        price: toBani(price + extra),
        originalPrice: toBani(p.price + extra),
        unitsPerPurchase: units > 1 ? units : undefined,
        fromPromoList: generic,
      });
    }
  }

  const notes = [
    "Glovo: taxa de livrare este cea afișată public pentru oraș; la adresa ta poate diferi.",
    "Glovo: taxa de servicii (10%, între 1,99 și 10,99 lei) și suprataxa de coș mic (5,99 lei sub 40 lei) sunt cele din coșul Glovo la București, noiembrie 2026.",
  ];
  if (store.deliveryFeeInfo?.fee == null) notes.push("Taxa de livrare nu a putut fi citită; am presupus 0.");
  if (store.open === false) notes.push("Localul este închis acum pe Glovo.");

  const fees: FeeRules = {
    deliveryFee: toBani(store.deliveryFeeInfo?.fee ?? 0),
    minOrder: 0,
    ...GLOVO_BASKET_FEES,
    notes,
  };

  const offers: Offer[] = [];
  const discounted = [...byId.values()].filter((r) => r.originalPrice != null && r.originalPrice > r.price).length;
  if (discounted > 0) {
    offers.push({ kind: "info", label: `${discounted} produse la reducere (aplicat în prețuri)` });
  }
  for (const p of store.promotions ?? []) {
    const label = [p.title, p.description].filter(Boolean).join(" ");
    if (label) offers.push({ kind: "info", label: `${label} (neinclus în calcul)` });
  }

  return {
    storeName: store.name,
    items: [...byId.values()].map((r) => enrichItem(r, store.name)),
    fees,
    offers,
  };
}

function slugify(q: string): string {
  return normalize(q).replace(/ /g, "-");
}

export const glovo: PlatformAdapter = {
  id: "glovo",

  async searchVenues(q, lat, lon) {
    const city = nearestCity(lat, lon);
    if (city.distanceM > 40000) return []; // no Glovo city nearby
    const nq = normalize(q).replace(/ /g, "");
    const matches = (e: GEntry) =>
      normalize(e.title).replace(/ /g, "").includes(nq) || e.slug.replace(/-/g, "").includes(nq);
    const toVenue = (e: { slug: string; title: string; distance?: string; availability?: { status?: string } }): Venue => ({
      platform: "glovo",
      id: e.slug,
      slug: e.slug,
      name: e.title,
      distanceM: parseDistance(e.distance),
      online: e.availability?.status ? e.availability.status === "OPEN" : undefined,
      url: `${BASE}/${city.slug}/stores/${e.slug}`,
      extra: { city: city.slug },
    });

    let found = (await cityIndex(city.slug, "priority")).filter(matches);
    if (found.length === 0) found = (await cityIndex(city.slug, "all")).filter(matches);
    if (found.length > 0) return found.map(toVenue);

    // Last resort: Glovo slugs often look like "<name>" or "<name>-<city code>".
    const base = slugify(q);
    if (!base) return [];
    for (const slug of [base, `${base}-${city.slug.slice(0, 3)}`]) {
      try {
        const parsed = parseGlovoStorePage(await fetchPage(`${BASE}/${city.slug}/stores/${slug}`));
        if (parsed && parsed.items.length > 0) return [toVenue({ slug, title: parsed.storeName })];
      } catch {
        // try the next candidate
      }
    }
    return [];
  },

  async getMenu(venue) {
    const city = String(venue.extra?.city ?? "bucharest");
    const parsed = parseGlovoStorePage(await fetchPage(`${BASE}/${city}/stores/${venue.slug ?? venue.id}`));
    if (!parsed) throw new Error("Nu am putut citi meniul de pe pagina Glovo.");
    if (parsed.items.length === 0) throw new Error("Pagina Glovo nu conține produse.");
    return { items: parsed.items, fees: parsed.fees, offers: parsed.offers };
  },
};

import type { FeeRules, Offer, PlatformAdapter, PlatformMenu, Venue } from "../types";
import { enrichItem, type RawItem } from "./enrich";
import { fetchJson, haversineM } from "./http";

// Endpoints used by wolt.com itself (unofficial, verified 2026-11).
const SEARCH_URL = "https://restaurant-api.wolt.com/v1/pages/search";
const assortmentUrl = (slug: string) =>
  `https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/${slug}/assortment`;
const dynamicUrl = (slug: string, lat: number, lon: number) =>
  `https://consumer-api.wolt.com/order-xp/web/v1/venue/slug/${slug}/dynamic/?lat=${lat}&lon=${lon}`;

interface WSearch {
  city?: string;
  sections?: {
    items?: {
      template?: string;
      venue?: {
        id: string;
        slug: string;
        name: string;
        address?: string;
        location?: [number, number];
        online?: boolean;
        delivers?: boolean;
        product_line?: string;
      };
    }[];
  }[];
}

interface WOptionValue {
  price: number;
}
interface WAssortment {
  categories: WCategory[];
  items: {
    id: string;
    name: string;
    description?: string;
    price: number;
    original_price?: number | null;
    disabled_info?: unknown;
    is_cutlery?: boolean;
    is_wolt_plus_only?: boolean;
    alcohol_permille?: number;
    options?: {
      option_id: string;
      multi_choice_config?: { total_range?: { min?: number } };
    }[];
  }[];
  options?: { id: string; values?: WOptionValue[] }[];
}
interface WCategory {
  name: string;
  item_ids?: string[];
  subcategories?: WCategory[];
}

interface WDiscount {
  effects: {
    basket_discount?: { amount?: number; fraction?: number; max_amount?: number | null } | null;
    delivery_discount?: { fraction?: number } | null;
    item_discount?: {
      fraction?: number;
      amount_per_item?: number | null;
      include?: { items?: string[] | null } | null;
    } | null;
    free_items?: unknown;
  };
  conditions: {
    basket_contains?: { min_amount?: number | null }[];
    has_wolt_plus?: boolean | null;
    weekly_time_restrictions?: unknown;
    payment_method?: unknown;
  };
  description?: { title?: string; points?: string[] };
}
interface WDynamic {
  venue?: { online?: boolean };
  venue_raw?: {
    discounts?: WDiscount[];
    delivery_specs?: {
      order_minimum_possible?: number;
      original_delivery_price?: number | null;
      delivery_pricing?: {
        base_price?: number;
        price_ranges?: { min: number; max: number; a: number; b: number }[];
      } | null;
    };
  };
}

/** Offers we cannot assume apply to an existing, regular account. */
function restriction(d: WDiscount): string | null {
  const text = (d.description?.points ?? []).join(" ").toLowerCase();
  if (/new users|utilizatori noi|first order|prima comand/.test(text)) return "doar utilizatori noi";
  if (d.conditions.has_wolt_plus === true) return "doar Wolt+";
  if (d.conditions.payment_method) return "doar cu o anumită metodă de plată";
  if (d.conditions.weekly_time_restrictions) return "doar în anumite intervale orare";
  return null;
}

export function parseWoltMenu(a: WAssortment, d: WDynamic, venueName: string): PlatformMenu {
  const categoryOf = new Map<string, string>();
  const walk = (cats: WCategory[]) => {
    for (const c of cats) {
      for (const id of c.item_ids ?? []) if (!categoryOf.has(id)) categoryOf.set(id, c.name);
      if (c.subcategories?.length) walk(c.subcategories);
    }
  };
  walk(a.categories ?? []);

  const optionById = new Map((a.options ?? []).map((o) => [o.id, o]));
  const discounts = d.venue_raw?.discounts ?? [];

  // Item-level discounts available to everyone.
  const itemFraction = new Map<string, number>();
  const offers: Offer[] = [];
  for (const disc of discounts) {
    const title = disc.description?.title ?? "Ofertă";
    const why = restriction(disc);
    const e = disc.effects;
    if (why) {
      offers.push({ kind: "info", label: `${title} (${why} – neinclus în calcul)` });
      continue;
    }
    if (e.item_discount?.fraction && e.item_discount.include?.items?.length) {
      for (const id of e.item_discount.include.items) {
        itemFraction.set(id, Math.max(itemFraction.get(id) ?? 0, e.item_discount.fraction));
      }
      offers.push({ kind: "info", label: `${title} (aplicat în prețuri)` });
    } else if (e.basket_discount && (e.basket_discount.fraction || e.basket_discount.amount)) {
      const minSubtotal = Math.max(0, ...(disc.conditions.basket_contains ?? []).map((c) => c.min_amount ?? 0));
      if (e.basket_discount.fraction) {
        offers.push({
          kind: "percent",
          label: title,
          pct: e.basket_discount.fraction * 100,
          minSubtotal,
          maxDiscount: e.basket_discount.max_amount ?? null,
        });
      } else {
        offers.push({ kind: "amount", label: title, amount: e.basket_discount.amount ?? 0, minSubtotal });
      }
    } else if (e.delivery_discount?.fraction === 1) {
      const minSubtotal = Math.max(0, ...(disc.conditions.basket_contains ?? []).map((c) => c.min_amount ?? 0));
      offers.push({ kind: "freeDelivery", label: title, minSubtotal });
    } else {
      offers.push({ kind: "info", label: `${title} (neinclus în calcul)` });
    }
  }

  const raws: RawItem[] = [];
  for (const it of a.items ?? []) {
    if (it.disabled_info || it.is_cutlery || it.is_wolt_plus_only) continue;
    if ((it.alcohol_permille ?? 0) > 0) continue;
    // Mandatory choices (e.g. "alege cartofii") can add to the price: assume the cheapest.
    let extra = 0;
    for (const o of it.options ?? []) {
      const min = o.multi_choice_config?.total_range?.min ?? 0;
      if (min < 1) continue;
      const prices = (optionById.get(o.option_id)?.values ?? []).map((v) => v.price ?? 0).sort((x, y) => x - y);
      for (let i = 0; i < min && i < prices.length; i++) extra += prices[i];
    }
    const listed = it.original_price && it.original_price > it.price ? it.original_price : it.price;
    let price = it.price;
    const frac = itemFraction.get(it.id);
    if (frac) price = Math.min(price, Math.round(listed * (1 - frac)));
    raws.push({
      id: it.id,
      name: it.name,
      description: it.description,
      category: categoryOf.get(it.id) ?? "",
      price: price + extra,
      originalPrice: listed + extra,
    });
  }

  const specs = d.venue_raw?.delivery_specs;
  const notes: string[] = [];
  const deliveryFee = specs?.original_delivery_price ?? specs?.delivery_pricing?.base_price;
  if (deliveryFee == null) notes.push("Taxa de livrare nu a putut fi citită; am presupus 0.");
  const ranges = specs?.delivery_pricing?.price_ranges ?? null;
  if (!ranges?.length) notes.push("Taxa de serviciu nu a putut fi citită; am presupus 0.");
  if (d.venue?.online === false) notes.push("Localul este închis acum pe Wolt.");

  const fees: FeeRules = {
    deliveryFee: deliveryFee ?? 0,
    minOrder: specs?.order_minimum_possible ?? 0,
    basketFeeRanges: ranges,
    notes,
  };

  return { items: raws.map((r) => enrichItem(r, venueName)), fees, offers };
}

export const wolt: PlatformAdapter = {
  id: "wolt",

  async searchVenues(q, lat, lon) {
    const data = await fetchJson<WSearch>(SEARCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q, target: "venues", lat, lon }),
    });
    const city = data.city ?? "bucharest";
    const out: Venue[] = [];
    for (const s of data.sections ?? []) {
      for (const it of s.items ?? []) {
        const v = it.venue;
        if (!v || v.product_line !== "restaurant" || !v.delivers) continue;
        out.push({
          platform: "wolt",
          id: v.id,
          slug: v.slug,
          name: v.name,
          address: v.address && !/virtual venue/i.test(v.address) ? v.address : undefined,
          distanceM: v.location ? haversineM(lat, lon, v.location[1], v.location[0]) : undefined,
          online: v.online,
          url: `https://wolt.com/ro/rou/${city}/restaurant/${v.slug}`,
        });
      }
    }
    return out;
  },

  async getMenu(venue, lat, lon) {
    const slug = venue.slug ?? venue.id;
    const [a, d] = await Promise.all([
      fetchJson<WAssortment>(assortmentUrl(slug)),
      fetchJson<WDynamic>(dynamicUrl(slug, lat, lon)),
    ]);
    return parseWoltMenu(a, d, venue.name);
  },
};

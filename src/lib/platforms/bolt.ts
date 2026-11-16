import type { FeeRules, PlatformAdapter, PlatformMenu, Venue } from "../types";
import { enrichItem, type RawItem } from "./enrich";
import { fetchJson } from "./http";
import { normalize } from "../weight";

// The web API food.bolt.eu itself uses (unofficial, verified 2026-11). It answers
// without a login; the session and device ids are made up and can be anything.
const BASE = "https://deliveryuser.live.boltsvc.net/deliveryClient/public";
const COMMON =
  "version=FW.1.122&language=ro-RO&session_id=11111111-2222-4333-8444-555555555555&country=ro" +
  "&device_name=web&device_os_version=web&deviceId=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&deviceType=web";
const HEADERS = { origin: "https://food.bolt.eu" };

/**
 * Bolt's service fee is not public. Two real checkouts (Bucharest, 2026-11) gave
 * 3.23 lei on 39.90 and 9.00 lei on 119.70, which a line through both reproduces:
 * 0.35 lei + 7.23% of the products. Reliable between roughly 40 and 120 lei;
 * outside that it is an extrapolation. The returnable-packaging deposit
 * (0.50 lei per bottle) is not counted.
 */
const BOLT_SERVICE_FEE = { pct: 7.23, flat: 35 };

// Bolt links carry the city; only Bucharest (id 325) was verified.
const CITY_PATH = "325-bucharest";

interface BText {
  value?: string;
}
interface BPrice {
  value: number;
}
interface BSearch {
  data?: {
    providers?: {
      id: number;
      name: string;
      slug?: string;
      delivery?: { fee?: BPrice | null };
      availability?: { delivery?: { instant?: boolean } };
    }[];
  };
}
export interface BNode {
  type: "menu" | "category" | "dish" | "option_select_group" | "option_select";
  id: number;
  parent_id: number | null;
  child_ids?: number[];
  name?: BText;
  description?: BText | null;
  price?: BPrice;
  availability?: string;
  is_required?: boolean;
}
export interface BMenu {
  data?: { items?: Record<string, BNode> };
}

export function parseBoltMenu(menu: BMenu, deliveryFee: number | null, venueName: string): PlatformMenu {
  const nodes = menu.data?.items ?? {};
  const raws: RawItem[] = [];
  for (const n of Object.values(nodes)) {
    if (n.type !== "dish" || !n.name?.value || !n.price) continue;
    if (n.availability && n.availability !== "in_stock") continue;

    // Each required group asks for one choice (fries, drink...): assume the cheapest.
    let extra = 0;
    for (const gid of n.child_ids ?? []) {
      const g = nodes[String(gid)];
      if (g?.type !== "option_select_group" || !g.is_required) continue;
      const prices = (g.child_ids ?? [])
        .map((id) => nodes[String(id)])
        .filter((o) => o?.type === "option_select" && o.price && (!o.availability || o.availability === "in_stock"))
        .map((o) => Math.round((o.price as BPrice).value * 100))
        .sort((a, b) => a - b);
      if (prices.length > 0) extra += prices[0];
    }

    const description = (n.description?.value ?? "").trim();
    const parent = n.parent_id != null ? nodes[String(n.parent_id)] : undefined;
    raws.push({
      id: String(n.id),
      name: n.name.value,
      // Bolt fills empty descriptions with this placeholder.
      description: /^unnamed product$/i.test(description) ? "" : description,
      category: parent?.type === "category" ? (parent.name?.value ?? "") : "",
      price: Math.round(n.price.value * 100) + extra,
    });
  }

  const notes = [
    "Bolt Food: taxa de servicii (≈ 0.35 lei + 7.23%) e dedusă din două comenzi reale (40 și 120 lei), deci e sigură doar între aceste valori; garanția pentru sticle (0,50 lei) nu e inclusă.",
  ];
  if (deliveryFee == null) notes.push("Taxa de livrare nu a putut fi citită; am presupus 0.");

  const fees: FeeRules = { deliveryFee: deliveryFee ?? 0, minOrder: 0, serviceFee: BOLT_SERVICE_FEE, notes };
  return { items: raws.map((r) => enrichItem(r, venueName)), fees, offers: [] };
}

export const bolt: PlatformAdapter = {
  id: "bolt",

  async searchVenues(q, lat, lon) {
    const data = await fetchJson<BSearch>(`${BASE}/deliverySearch?${COMMON}`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify({
        delivery_lat: lat,
        delivery_lng: lon,
        search_string: q,
        sorter: { property: "relevance", direction: "descending" },
        filters: [],
        search_tab_id: "all",
      }),
    });
    const out: Venue[] = [];
    for (const p of data.data?.providers ?? []) {
      if (p.availability?.delivery?.instant === false) continue;
      out.push({
        platform: "bolt",
        id: String(p.id),
        slug: p.slug,
        name: p.name,
        online: true,
        url: `https://food.bolt.eu/ro-ro/${CITY_PATH}/p/${p.slug ?? p.id}/`,
        extra: { fee: p.delivery?.fee?.value ?? null },
      });
    }
    // The search also returns other places with similar words; when some venues
    // carry the query in their name, those are the ones asked for.
    const nq = normalize(q).replace(/ /g, "");
    const named = out.filter((v) => normalize(v.name).replace(/ /g, "").includes(nq));
    return named.length > 0 ? named : out;
  },

  async getMenu(venue, lat, lon) {
    const menu = await fetchJson<BMenu>(
      `${BASE}/getMenuCategories?provider_id=${venue.id}&delivery_lat=${lat}&delivery_lng=${lon}&${COMMON}`,
      { headers: HEADERS },
    );
    const fee = venue.extra?.fee;
    return parseBoltMenu(menu, typeof fee === "number" ? Math.round(fee * 100) : null, venue.name);
  },
};

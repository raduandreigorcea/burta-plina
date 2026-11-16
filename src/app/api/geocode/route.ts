import { cached } from "@/lib/cache";

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
}

/** Address -> coordinates via OpenStreetMap Nominatim. */
const HEADERS = { "user-agent": "food-budget-optimizer/0.1 (personal use)", "accept-language": "ro" };

interface ReverseHit {
  display_name?: string;
  address?: Record<string, string>;
}

/** "Strada Lipscani 10, București" from a Nominatim reverse result. */
function shortAddress(h: ReverseHit): string | null {
  const a = h.address ?? {};
  const street = [a.road ?? a.pedestrian ?? a.neighbourhood, a.house_number].filter(Boolean).join(" ");
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
  const short = [street, a.suburb && a.suburb !== city ? a.suburb : "", city].filter(Boolean).join(", ");
  return short || h.display_name || null;
}

/** Coordinates -> address (used for "my location"). */
async function reverse(lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Coordonate invalide." }, { status: 400 });
  }
  try {
    const label = await cached(
      `rev:${lat.toFixed(4)}:${lon.toFixed(4)}`,
      async () => {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`;
        const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000), cache: "no-store" });
        if (!res.ok) throw new Error(`Geocodarea a eșuat (${res.status}).`);
        return shortAddress((await res.json()) as ReverseHit);
      },
      24 * 60 * 60 * 1000,
    );
    return Response.json({ label });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.has("lat") && params.has("lon")) return reverse(Number(params.get("lat")), Number(params.get("lon")));
  const q = (params.get("q") ?? "").trim();
  if (q.length < 3) return Response.json({ error: "Adresă prea scurtă." }, { status: 400 });
  try {
    const hits = await cached(
      `geo:${q.toLowerCase()}`,
      async () => {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ro&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, {
          headers: HEADERS,
          signal: AbortSignal.timeout(10000),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Geocodarea a eșuat (${res.status}).`);
        return (await res.json()) as NominatimHit[];
      },
      24 * 60 * 60 * 1000,
    );
    return Response.json({
      results: hits.map((h) => ({ lat: Number(h.lat), lon: Number(h.lon), label: h.display_name })),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

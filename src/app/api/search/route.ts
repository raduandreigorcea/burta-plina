import { searchAll } from "@/lib/service";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (!q || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "Lipsește restaurantul sau locația." }, { status: 400 });
  }
  return Response.json({ platforms: await searchAll(q, lat, lon) });
}

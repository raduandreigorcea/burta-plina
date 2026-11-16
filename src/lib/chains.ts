import { normalize } from "./weight";

/** A fast-food chain the app is checked against, with what people type for it. */
export interface Chain {
  /** Shown in the list and sent to the platforms as the search text. */
  name: string;
  /** File name of the logo in public/logos/ (slug.svg or slug.png), if one is there. */
  slug: string;
  /** Monogram and colours shown when there is no logo file. */
  short: string;
  bg: string;
  fg: string;
  /** Background behind the logo file, when the logo is not meant for white. */
  logoBg?: string;
  /** Short forms and common misspellings, besides the name itself. */
  aliases: string[];
}

export const CHAINS: Chain[] = [
  { name: "McDonald's", slug: "mcdonalds", short: "M", bg: "#FFC72C", fg: "#DA291C", logoBg: "#DA291C", aliases: ["mc", "mec", "mac", "mcd", "mec donalds", "mac donalds", "mcdonald", "donalds"] },
  { name: "KFC", slug: "kfc", short: "KFC", bg: "#E4002B", fg: "#FFFFFF", aliases: ["kentucky", "kentucky fried chicken", "kfc ro"] },
  { name: "Burger King", slug: "burger-king", short: "BK", bg: "#F5EBDC", fg: "#D62300", aliases: ["bk", "burgerking", "king", "whopper"] },
  { name: "Popeyes", slug: "popeyes", short: "P", bg: "#F26B21", fg: "#FFFFFF", aliases: ["popeye", "popeys", "popayes", "popais"] },
  { name: "Taco Bell", slug: "taco-bell", short: "TB", bg: "#702082", fg: "#FFFFFF", aliases: ["tacobell", "taco", "tb"] },
  { name: "Spartan", slug: "spartan", short: "S", bg: "#1F2A44", fg: "#FFFFFF", aliases: ["spartan gyros", "gyros"] },
  { name: "Mesopotamia", slug: "mesopotamia", short: "Me", bg: "#8B5A2B", fg: "#FFFFFF", aliases: ["meso", "mezopotamia", "mesopotania", "kebab mesopotamia"] },
  { name: "Dristor Kebap", slug: "dristor-kebap", short: "DK", bg: "#E31E24", fg: "#FFFFFF", aliases: ["dristor", "dristor kebab", "kebap", "kebab"] },
  { name: "Calif", slug: "calif", short: "C", bg: "#F4B400", fg: "#2B2B2B", aliases: ["calif kebab", "califul"] },
  { name: "Pizza Hut", slug: "pizza-hut", short: "PH", bg: "#EE3124", fg: "#FFFFFF", aliases: ["pizzahut", "hut", "ph"] },
  { name: "Noodle Pack", slug: "noodle-pack", short: "NP", bg: "#E2231A", fg: "#FFFFFF", aliases: ["noodlepack", "noodle", "noodles", "nudle"] },
  { name: "Subway", slug: "subway", short: "SW", bg: "#009743", fg: "#FFC600", aliases: ["sub", "subwey", "sabuei"] },
];

const squash = (s: string) => normalize(s).replace(/ /g, "");

/** Edits needed to turn a into b (insert, delete, replace). */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** 0 = starts a name or alias, 1 = is inside one, 2 = a typo away; null = no match. */
function rank(chain: Chain, q: string): number | null {
  const keys = [chain.name, ...chain.aliases].map(squash);
  if (keys.some((k) => k.startsWith(q))) return 0;
  if (q.length >= 3 && keys.some((k) => k.includes(q))) return 1;
  // One slip for short words, two for long ones, against the start of the key.
  const slips = q.length >= 7 ? 2 : 1;
  if (q.length >= 3 && keys.some((k) => distance(q, k.slice(0, Math.max(q.length, Math.min(k.length, q.length + 1)))) <= slips)) return 2;
  return null;
}

/** Chains matching what was typed so far, best first; all of them for an empty text. */
export function suggestChains(text: string): Chain[] {
  const q = squash(text);
  if (!q) return CHAINS;
  return CHAINS.map((chain, i) => ({ chain, i, r: rank(chain, q) }))
    .filter((x): x is { chain: Chain; i: number; r: number } => x.r != null)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.chain);
}

/**
 * What to search for: the chain's name when the text is one of its short forms
 * or the only thing it can mean ("mec" -> "McDonald's"); otherwise the text itself.
 */
export function resolveChain(text: string): string {
  const q = squash(text);
  if (!q) return text.trim();
  const exact = CHAINS.find((c) => [c.name, ...c.aliases].some((k) => squash(k) === q));
  if (exact) return exact.name;
  const hits = suggestChains(text);
  if (q.length < 3 || hits.length === 0) return text.trim();
  // One candidate, or the text is the beginning of a name ("burger" -> Burger King).
  const begins = [hits[0].name, ...hits[0].aliases].some((k) => squash(k).startsWith(q));
  return hits.length === 1 || begins ? hits[0].name : text.trim();
}

/** The known chain a venue belongs to ("KFC Unirea" -> KFC), if any. */
export function chainOfVenue(venueName: string): Chain | undefined {
  const v = squash(venueName);
  return CHAINS.find((c) => v.includes(squash(c.name)));
}

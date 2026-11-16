import type { Includes, ItemKind } from "./types";

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface ParsedWeight {
  grams: number;
  uncertain: boolean;
  /** True when the weight is a volume (ml / l), i.e. most likely a drink. */
  volume: boolean;
}

const UNIT: Record<string, number> = {
  kg: 1000,
  g: 1,
  gr: 1,
  grame: 1,
  ml: 1,
  cl: 10,
  l: 1000,
};

// optional "2 x " multiplier, number, unit. The unit may be glued to the next
// sentence ("230gCartofi prăjiți"), so only a letter that continues the same
// word rules a match out: a lowercase one, or more capitals ("2 LEGUME").
const WEIGHT_RE =
  /(?:(\d{1,2})\s*(?:[xX×]|[bB][uU][cC]\.?\s*[xX])\s*)?(\d+(?:[.,]\d+)?)\s*([kK][gG]|[gG][rR][aA][mM][eE]|[gG][rR]|[gG]|[mM][lL]|[cC][lL]|[lL])(?![a-zăâîșț]|[A-ZĂÂÎȘȚ]{2})/g;

interface Match {
  grams: number;
  start: number;
  end: number;
  volume: boolean;
}

function findWeights(text: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(WEIGHT_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = text.slice(Math.max(0, start - 6), start).toLowerCase();
    const after = text.slice(end, end + 12).toLowerCase();
    const value = parseFloat(m[2].replace(",", "."));
    const unit = m[3].toLowerCase();
    // Nutritional references: "kcal/100g", "per 100 g", "la 100g", "100 g produs"
    if (value === 100 && unit !== "kg" && unit !== "l") {
      if (/(\/|per|la|pe|kcal|kj)\s*$/.test(before) || /^\s*(produs|de produs)/.test(after)) continue;
    }
    // "12g proteine", "5 g zahar" etc. are nutrients, not portion weights
    if (/^\s*(de\s+)?(protein|grasimi|grăsimi|zahar|zahăr|carbohidrati|carbohidrați|sare|fibre)/.test(after))
      continue;
    // "150 g de carne de vită la grătar" is the patty, not the portion.
    if (/^\s*de\s+(carne|vita|vită|pui|porc)/.test(after)) continue;
    // "Glucide: 17.18g", "Proteine: 6.67 g": a nutrition table.
    const label = text.slice(Math.max(0, start - 24), start).toLowerCase();
    if (/(grasimi|grăsimi|saturati|saturați|glucide|carbohidrati|carbohidrați|zaharuri|zahar|zahăr|proteine|sare|fibre)\)?\s*:\s*(?:[a-zăâîșț]+\s*:\s*)?$/.test(label))
      continue;
    const mult = m[1] ? parseInt(m[1], 10) : 1;
    const grams = value * UNIT[unit] * mult;
    if (grams < 5 || grams > 10000) continue;
    out.push({ grams, start, end, volume: unit === "ml" || unit === "cl" || unit === "l" });
  }
  return out;
}

interface Component {
  /** Smallest of the alternatives ("X 165g sau Y 150g" -> 150). */
  grams: number;
  volume: boolean;
  sauce: boolean;
  /** Written after a dash ("... - 395g"): how a total is usually given. */
  dashed: boolean;
}

/**
 * Several weights in one text describe a combo: "Twister 180g, cartofi 120g,
 * 1 băutură 0,5L, 1 sos la alegere 54g/25g". The food weight is the sum of the
 * solid components; drinks and sauces are left out, and for alternatives
 * ("sau", "/") the smallest one counts.
 */
function fromText(text: string): ParsedWeight | null {
  const ms = findWeights(text);
  if (ms.length === 0) return null;
  if (ms.length === 1) return { grams: Math.round(ms[0].grams), uncertain: false, volume: ms[0].volume };

  const comps: Component[] = [];
  let listLike = true;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    const between = i === 0 ? text.slice(0, m.start) : text.slice(ms[i - 1].end, m.start);
    const isAlt = i > 0 && (/^[\s)]*\/\s*$/.test(between) || /(^|[^a-zăâîșț])sau/i.test(between));
    if (isAlt) {
      const c = comps[comps.length - 1];
      c.grams = Math.min(c.grams, m.grams);
      c.volume = c.volume && m.volume;
      continue;
    }
    if (i > 0 && !/[,+;]|(^|\s)(și|si|şi)\s/i.test(between)) listLike = false;
    // The words right before the weight, back to the previous comma.
    const segment = between.slice(Math.max(between.lastIndexOf(","), between.lastIndexOf("(")) + 1);
    comps.push({
      grams: m.grams,
      volume: m.volume,
      sauce: /^\s*\d*\s*(sos|sosuri)(\s|$)/i.test(segment),
      dashed: /[-–—]\s*$/.test(between),
    });
    // "CARNE 200 GR, CARTOFI 200 GR, GREUTATE MINIMA PRODUS 450 GR": the total, said outright.
    if (/(greutate|gramaj|total)[^,;.]*$/i.test(between) && !m.volume) {
      return { grams: Math.round(m.grams), uncertain: false, volume: false };
    }
  }

  // "Gyros 415g, cartofi 100g, băutură - 515g + 330ml": the parts, then their total.
  const weighed = comps.filter((c) => !c.volume);
  if (weighed.length >= 2) {
    const last = weighed[weighed.length - 1];
    const total = last.grams;
    const parts = weighed.slice(0, -1).reduce((a, c) => a + c.grams, 0);
    // Either the sum of the parts, or given after a dash and no smaller than them
    // (some parts, like the bread, are often listed without a weight).
    const sums = weighed.length >= 3 && Math.abs(total - parts) <= total * 0.1;
    if (sums || (last.dashed && total >= parts * 0.9)) {
      return { grams: Math.round(total), uncertain: false, volume: false };
    }
  }

  const solid = comps.filter((c) => !c.volume && !c.sauce);
  // The same weight repeated in running text is one product listed in several
  // variants ("... cu vită 400g (949 kJ) ... cu pui 400g ..."), not parts to add up.
  if (solid.length > 1 && !listLike && solid.every((c) => c.grams === solid[0].grams)) {
    return { grams: Math.round(solid[0].grams), uncertain: false, volume: false };
  }
  if (solid.length > 0) {
    return { grams: Math.round(solid.reduce((a, c) => a + c.grams, 0)), uncertain: !listLike, volume: false };
  }
  const rest = comps.filter((c) => !c.sauce);
  const used = rest.length > 0 ? rest : comps;
  return {
    grams: Math.round(used.reduce((a, c) => a + c.grams, 0)),
    uncertain: !listLike,
    volume: used.every((c) => c.volume),
  };
}

const PORTION_RE = /por[tțţ]ie\s*\(\s*(?:\d+\s*buc\.?\s*\/\s*)?(\d+(?:[.,]\d+)?)\s*(kg|gr|g)\s*\)/i;
const INGREDIENTS_RE = /ingrediente\s*:|ingr\s*:/i;

export function parseWeight(
  name: string,
  description: string,
): (ParsedWeight & { source: "name" | "description" }) | null {
  const n = fromText(name);
  // "Smart Combo cu doză 330ml": the name gives the drink, the description the food.
  const nameIsDrinkOfCombo = !!n?.volume && normalize(name).split(" ").some((t) => COMBO_NAME_WORDS.includes(t));
  if (n && !nameIsDrinkOfCombo) return { ...n, source: "name" };
  const d = fromDescription(name, description);
  if (d && !(n && d.volume)) return { ...d, source: "description" };
  return n ? { ...n, source: "name" } : null;
}

function fromDescription(name: string, description: string): ParsedWeight | null {
  // "Porție (181g)", "Porție (9buc/127g)": said outright, whatever else the text lists.
  const portion = description.match(PORTION_RE);
  if (portion) {
    const grams = Math.round(parseFloat(portion[1].replace(",", ".")) * UNIT[portion[2].toLowerCase()]);
    if (grams >= 5) return { grams, uncertain: false, volume: false };
  }
  // An ingredient list gives the weight of every component ("Carne de vită (70g), Chifla (54g)"):
  // those are not portions. What is said before the list counts; a sum of what is in it is a guess.
  const cut = description.search(INGREDIENTS_RE);
  if (cut >= 0) {
    const before = cut > 0 ? fromText(description.slice(0, cut)) : null;
    if (before) return before;
    const inside = fromText(description.slice(cut));
    if (!inside) return null;
    return { ...inside, uncertain: inside.uncertain || findWeights(description.slice(cut)).length > 1 };
  }
  const d = fromText(description);
  if (!d) return null;
  // A combo whose description mentions one weight somewhere in the middle
  // ("5 tenders with our Dip (200 g) and a Pepsi"): that is one part, not the whole.
  const found = findWeights(description);
  const buried = found.length === 1 && found[0].start > 3 && description.length - found[0].end > 8;
  const combo = /(^| )(combo|for \d|pentru \d)( |$)/.test(normalize(name));
  return { ...d, uncertain: d.uncertain || (combo && buried) };
}

/** Manual weights for one chain: normalized item name -> grams. */
export interface WeightTable {
  /** Normalized substrings of the venue name this table applies to. */
  match: string[];
  items: Record<string, number>;
}

export function lookupWeight(tables: WeightTable[], venueName: string, itemName: string): number | null {
  const v = normalize(venueName);
  const n = normalize(itemName);
  for (const t of tables) {
    if (!t.match.some((m) => v.includes(normalize(m)))) continue;
    const entries = Object.entries(t.items).map(([k, g]) => [normalize(k), g] as const);
    const exact = entries.find(([k]) => k === n);
    if (exact) return exact[1];
  }
  return null;
}

const DRINK_WORDS = [
  "bautur", "drink", "racoritoare", "suc", "sucuri", "cola", "pepsi", "fanta", "sprite", "apa",
  "bere", "beer", "vin", "cafea", "coffee", "ceai", "tea", "limonad", "lemonade", "shake",
  "smoothie", "energizant", "juice", "latte", "cappuccino", "espresso", "frappe", "mirinda",
  "7up", "lipton", "schweppes", "dorna", "borsec", "aqua", "red bull", "fuzetea",
];
const SAUCE_WORDS = ["sos", "sosuri", "sauce", "sauces", "dip", "dips", "ketchup", "maioneza", "mustar"];
const SOUP_WORDS = ["supa", "ciorba", "bors", "crema"];
/** Categories of fried sides that go with a burger. */
const SIDE_CATEGORY_WORDS = ["garnitur", "side", "sides"];
/** Fries by name: "Cartofi prăjiți ...", "Really Crunchy Fries". */
const SIDE_FIRST_WORDS = ["cartofi"];
const SIDE_ANY_WORDS = ["fries"];
/** Salads: by category, by the first word of the name, or by a word anywhere in it. */
const SALAD_CATEGORY_WORDS = ["salat", "salad"];
const SALAD_FIRST_WORDS = ["salata", "salad"];
const SALAD_ANY_WORDS = ["coleslaw", "salad"];
/** Desserts, the same three ways. */
const DESSERT_CATEGORY_WORDS = ["desert", "dessert", "patiserie", "dulciuri"];
const DESSERT_FIRST_WORDS = [
  "placinta", "inghetata", "croissant", "briosa", "gogoasa", "prajitura", "tarta", "mousse", "fursec",
];
const DESSERT_ANY_WORDS = [
  "pie", "cookie", "cookies", "cheesecake", "donut", "brownie", "muffin", "mcpops", "sundae", "mcflurry",
];
/** What nobody asks for on its own: toppings, bread, fruit and vegetables. */
const OTHER_CATEGORY_WORDS = ["extra", "topping"];
const OTHER_FIRST_WORDS = ["chifla", "felii", "paine", "legume", "chips"];
const OTHER_ANY_WORDS = ["porumb"];
const MEATLESS_RE = /(^| )(plant based|plantbased|vegan|vegana|veggie|vegetarian|vegetariana|vegetarian[ae]?)( |$)/;
const BREAD_WORDS = ["panini", "lipie", "pita", "bagheta", "tortilla"];

/** Names that are a main dish whatever else they mention. */
const MAIN_WORDS = ["sandwich", "sandvis", "burger", "wrap"];
/** Words that make a sauce an ingredient or a part of something bigger. */
const SAUCE_CONNECTORS = ["cu", "with", "si", "and", "in", "plus"];
const COMBO_NAME_WORDS = ["meniu", "menu", "box", "bucket", "combo"];

/**
 * The product itself is a sauce: the name has a sauce word that is not just an
 * ingredient ("Burger cu sos BBQ") or a part of a combo ("Tenders & Dip Combo"),
 * and either the name ends with it ("Garlic Sauce") or the category is about sauces.
 */
function isSauceName(name: string, sauceCategory: boolean): boolean {
  if (/[&+]/.test(name)) return false;
  // Weights and counts are not part of the name ("... 200 g").
  const tokens = normalize(name)
    .split(" ")
    .filter((t) => !/^\d+(g|gr|ml|l)?$/.test(t) && t !== "g" && t !== "gr");
  const i = tokens.findIndex((t) => SAUCE_WORDS.includes(t));
  if (i < 0) return false;
  if (tokens.some((t) => COMBO_NAME_WORDS.includes(t))) return false;
  if (tokens.slice(0, i).some((t) => SAUCE_CONNECTORS.includes(t))) return false;
  return sauceCategory || i === tokens.length - 1;
}

const CATEGORY_FILLER = ["si", "and", "sau", "extra", "extras"];

function hasWord(text: string, words: string[]): boolean {
  const tokens = text.split(" ");
  return words.some((w) =>
    w.includes(" ") ? text.includes(w) : tokens.some((t) => t === w || (w.length >= 5 && t.startsWith(w))),
  );
}

export function classify(
  name: string,
  category: string,
  unitIsVolume = false,
  grams: number | null = null,
): ItemKind {
  const c = normalize(category);
  const n = normalize(name);
  // Only a category that is purely about sauces counts ("Sosuri", "Dips & Sauces"),
  // not a mixed one like "Fries & Sauces".
  const catTokens = c.split(" ").filter((t) => t && !CATEGORY_FILLER.includes(t));
  if (catTokens.length > 0 && catTokens.every((t) => SAUCE_WORDS.includes(t))) return "sauce";
  if (hasWord(c, DRINK_WORDS)) return "drink";
  // Item names: only trust the first word for sauces ("Sos de usturoi"), so
  // "Burger cu sos BBQ" stays food.
  if (SAUCE_WORDS.includes(n.split(" ")[0])) return "sauce";
  // A sauce word anywhere plus a dip-sized portion ("Cheese sosuri 50g").
  if (grams != null && grams <= 80 && hasWord(n, SAUCE_WORDS)) return "sauce";
  // A big tub of sauce is still a sauce ("Ranch Dip N'Drip 200g", "The Garlic Sauce (200g)").
  if (isSauceName(name, hasWord(c, SAUCE_WORDS))) return "sauce";
  // A combo that comes with a can is still a meal ("Smart Combo Pui cu doză 330ml").
  const comboName = n.split(" ").some((t) => COMBO_NAME_WORDS.includes(t) || t === "deal");
  if (!comboName && hasWord(n, DRINK_WORDS) && unitIsVolume) return "drink";
  // A glass or bottle of something that is not a soup is a drink, whatever it is called.
  if (!comboName && unitIsVolume && grams != null && grams >= 150 && !hasWord(n, SOUP_WORDS)) return "drink";
  // A soup is mostly water: by weight it would beat every real meal.
  if (!comboName && (["supa", "ciorba", "bors"].includes(n.split(" ")[0]) || /(^| )(supe|ciorbe)( |$)/.test(c))) return "other";
  // Children's menus (smaller portions and a toy) are not what an adult orders.
  if (/(^| )(copii|kids|happy meal)( |$)/.test(n)) return "other";
  const nTokens = n.split(" ");
  // Meat substitutes are for those who look for them, not what "most food" means here.
  if (MEATLESS_RE.test(n) || MEATLESS_RE.test(c)) return "other";
  // Fries with a topping ("Loaded Chicken Fries") are still fries: a side, not the meal.
  const friesBased = nTokens.some((t) => t === "cartofi" || t === "fries");
  if (nTokens.includes("loaded") && friesBased) return "side";
  // A combo is a meal even when it sits next to the sides ("Meniu ...", "Hot Bucket").
  const combo = nTokens.some((t) => t === "meniu" || t === "menu" || t === "box" || t === "bucket");
  // Nachos with toppings are a snack to share, like loaded fries: mostly chips and sauce.
  if (!combo && nTokens.some((t) => t === "nachos" || t === "doritos")) return "side";
  if (combo || nTokens.includes("loaded")) {
    return "food";
  }
  // A sandwich with coleslaw in it is a sandwich, not a salad.
  if (nTokens.some((t) => MAIN_WORDS.includes(t))) return "food";
  const named = (first: string[], any: string[]) => first.includes(nTokens[0]) || nTokens.some((t) => any.includes(t));
  if (named(SALAD_FIRST_WORDS, SALAD_ANY_WORDS)) return "salad";
  if (named(DESSERT_FIRST_WORDS, DESSERT_ANY_WORDS)) return "dessert";
  if (named(OTHER_FIRST_WORDS, OTHER_ANY_WORDS)) return "other";
  // Bread on its own ("Panini", "Lipie 100g"); "Panini cu pui" is a sandwich.
  const words = nTokens.filter((t) => !/^\d+(g|gr)?$/.test(t) && t !== "g" && t !== "gr");
  if (words.length === 1 && BREAD_WORDS.includes(words[0])) return "other";
  if (SIDE_FIRST_WORDS.includes(nTokens[0]) || nTokens.some((t) => SIDE_ANY_WORDS.includes(t))) return "side";
  if (hasWord(c, SALAD_CATEGORY_WORDS)) return "salad";
  if (hasWord(c, DESSERT_CATEGORY_WORDS)) return "dessert";
  if (hasWord(c, OTHER_CATEGORY_WORDS)) return "other";
  if (hasWord(c, SIDE_CATEGORY_WORDS)) return "side";
  return "food";
}

/**
 * What a combo brings besides the main dish, read from its description:
 * "Twister 180g, 1 porție mare de cartofi prăjiți 120g, 1 băutură răcoritoare 0,5L".
 * Fries and drink only count for items named like a combo, so a wrap with fries inside does not.
 */
export function comboIncludes(name: string, description: string): Includes | undefined {
  const d = normalize(description);
  const out: Includes = {};
  if (normalize(name).split(" ").some((t) => COMBO_NAME_WORDS.includes(t))) {
    if (/(^| )(cartofi|fries)( |$)/.test(d)) out.fries = true;
    if (/(^| )(bautura|bauturi|racoritoare|suc|drink)( |$)/.test(d)) out.drink = true;
  }
  // "+ 1 sos", "2 sosuri incluse", "1 sos la alegere": a counted sauce, not an ingredient.
  if (/(^| )\d (sos|sosuri)( |$)/.test(`${normalize(name)} ${d}`)) out.sauce = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Plain fries: "Cartofi prăjiți porție mare", "Really Crunchy Fries". */
export function isFries(name: string): boolean {
  const t = normalize(name).split(" ");
  return t[0] === "cartofi" || t.includes("fries");
}

/** True when the weight in the text is expressed as volume (ml / l / cl). */
export function isVolume(text: string): boolean {
  return /\d\s*(ml|cl|l)(?![a-zăâîșț])/i.test(text);
}

/**
 * Key used to recognise the same product on another platform:
 * "Big Mac, burger de vită, 240 gr" and "Big Mac™" both give "big mac".
 */
export function baseName(name: string): string {
  const head = name.split(/,| - |\(/)[0];
  return normalize(head.replace(WEIGHT_RE, " "));
}

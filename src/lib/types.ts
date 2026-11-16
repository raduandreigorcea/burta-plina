export type PlatformId = "wolt" | "glovo" | "bolt";

export const PLATFORM_NAMES: Record<PlatformId, string> = {
  wolt: "Wolt",
  glovo: "Glovo",
  bolt: "Bolt Food",
};

/** All money values are integers in bani (1 leu = 100 bani). */
export type Bani = number;

export interface Venue {
  platform: PlatformId;
  id: string;
  slug?: string;
  name: string;
  address?: string;
  distanceM?: number;
  url: string;
  online?: boolean;
  /** Platform-specific data the adapter needs to fetch the menu later. */
  extra?: Record<string, string | number | boolean | null>;
}

/**
 * "food" = a main dish or a combo (burger, wrap, chicken, menu);
 * "side" = fries and other fried sides;
 * "salad" / "dessert" = only in the basket when asked for, one of each;
 * "other" = bread, fruit, toppings, children's menus: left out.
 */
export type ItemKind = "food" | "side" | "salad" | "dessert" | "other" | "drink" | "sauce";

/**
 * How many sides the basket may hold: none, at most one per main dish
 * (default), or no limit.
 */
export type SidesRule = "none" | "balanced" | "any";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Current price for one purchase (after item-level discounts). */
  price: Bani;
  /** Price before discount, when the item is discounted. */
  originalPrice?: Bani;
  /** How many units one purchase gives (2 for a 1+1 offer). */
  unitsPerPurchase?: number;
  /** Weight of ONE unit in grams (ml counted 1:1). null = unknown. */
  grams: number | null;
  weightSource?: "name" | "description" | "table" | "other-platform" | "derived";
  /** True when the weight was guessed from several numbers in the text. */
  weightUncertain?: boolean;
  kind: ItemKind;
  /** What comes with the main dish (a combo, or "+ 1 sos"). */
  includes?: Includes;
}

export interface Includes {
  fries?: boolean;
  drink?: boolean;
  sauce?: boolean;
}

export interface FeeRules {
  /** Delivery fee for this address. */
  deliveryFee: Bani;
  /** Subtotal from which delivery becomes free, if any. */
  freeDeliveryOver?: Bani | null;
  /** Hard minimum subtotal: below it the order cannot be placed. */
  minOrder: Bani;
  /**
   * Small-order surcharge. "difference": pay (threshold - subtotal) when below
   * threshold. "flat": pay a fixed amount when below threshold.
   */
  smallOrder?: { threshold: Bani; mode: "difference" | "flat"; flat?: Bani } | null;
  /** Service fee = clamp(subtotal * pct / 100, min, max) + flat. */
  serviceFee?: { pct?: number; min?: Bani; max?: Bani; flat?: Bani } | null;
  /**
   * Piecewise basket-dependent fee (Wolt style): for the range containing the
   * subtotal, fee = a + b * subtotal. max = 0 means "no upper bound". Covers
   * service fee and small-order top-up in one function; reported as serviceFee.
   */
  basketFeeRanges?: { min: Bani; max: Bani; a: number; b: number }[] | null;
  /** Human-readable caveats (e.g. fee could not be read, estimate used). */
  notes: string[];
}

export type Offer =
  | {
      kind: "percent";
      label: string;
      pct: number;
      minSubtotal: Bani;
      maxDiscount?: Bani | null;
    }
  | { kind: "amount"; label: string; amount: Bani; minSubtotal: Bani }
  | { kind: "freeDelivery"; label: string; minSubtotal: Bani }
  /** Informational only: shown to the user, not applied in the maths. */
  | { kind: "info"; label: string };

export interface PlatformMenu {
  items: MenuItem[];
  fees: FeeRules;
  offers: Offer[];
}

export interface PlatformAdapter {
  id: PlatformId;
  searchVenues(q: string, lat: number, lon: number): Promise<Venue[]>;
  getMenu(venue: Venue, lat: number, lon: number): Promise<PlatformMenu>;
}

export type BudgetScope = "total" | "food";
export type BudgetMode = "hard" | "flex";

export interface OptimizeOptions {
  budget: Bani;
  scope: BudgetScope;
  mode: BudgetMode;
  /** Flex mode: how far above the budget we may go, in percent. */
  tolerancePct: number;
  /** Max purchases of the same item. */
  maxPerItem: number;
  /** The basket must contain one drink (on its own or as part of a combo). */
  includeDrinks: boolean;
  /** The basket must contain fries (on their own or as part of a combo). */
  wantFries?: boolean;
  /** The basket must contain one sauce (on its own or included with a product). */
  includeSauces: boolean;
  /** The basket must contain one salad. */
  wantSalad?: boolean;
  /** The basket must contain one dessert. */
  wantDessert?: boolean;
  /** Use weights guessed from a text with several numbers (often wrong). */
  includeGuessed?: boolean;
  /** Default "balanced". */
  sides?: SidesRule;
  /** Bread, fruit, toppings, children's menus; off by default. */
  includeOther?: boolean;
  /** Products the user does not want; matched by name, ignoring case and diacritics. */
  excludeNames?: string[];
  /** When present, the multi-objective assistant runs besides the max-grams search. */
  preferences?: Preferences;
}

/** What a product is, for "I would like a burger and fries" (a combo covers several). */
export type DishCategory =
  | "burger"
  | "chicken"
  | "pizza"
  | "wrap"
  | "sandwich"
  | "kebab"
  | "fries"
  | "salad"
  | "dessert"
  | "drink"
  | "sauce";

/**
 * Relative importance of each part of the score. Value terms are averaged
 * (so they only matter relative to each other); variety and preferences are
 * modifiers. See DEFAULT_WEIGHTS in smart.ts for the reasoning behind the defaults.
 */
export interface ScoreWeights {
  /** Food weight, as a share of what the budget could buy at the best g/lei in the menu. */
  grams: number;
  /** Calories, same idea. Ignored when the menu does not publish them. */
  calories: number;
  /** Protein, same idea. Ignored when the menu does not publish it. */
  protein: number;
  /** Value for money: the same metrics per leu actually paid (fees included). */
  value: number;
  /** 0..1: score lost when the basket is all near-identical products. */
  variety: number;
  /** Bonus (in score points, 1 = a perfect basket) when all preferred products are in. */
  preferItem: number;
  /** Bonus when all preferred categories are covered. */
  preferCategory: number;
  /** Bonus for budget left unspent (0 = fill the budget). */
  savings: number;
}

export interface Preferences {
  /** Products that must be in the basket (by name). */
  must?: string[];
  /** Products that are nice to have (by name). */
  prefer?: string[];
  /** Categories that must be covered. */
  mustCategories?: DishCategory[];
  /** Categories that are nice to cover. */
  preferCategories?: DishCategory[];
  weights?: Partial<ScoreWeights>;
  /** How many alternative baskets besides the main one (default 2). */
  alternatives?: number;
}

export interface NutritionTotal {
  total: number;
  /** Purchased units whose nutrition is known / all units in the basket. */
  knownUnits: number;
  units: number;
}

export interface SmartSuggestion {
  /** Short name of the trade-off this basket stands for. */
  label: string;
  basket: Basket;
  /** Budget minus the counted cost. */
  remaining: Bani;
  /** Only what the menus state; null when no product in the basket has it. */
  kcal: NutritionTotal | null;
  protein: NutritionTotal | null;
  /** Score under the user's weights, 0..~1.3. */
  score: number;
  /** Weighted contribution of each score term, for transparency. */
  breakdown: Record<string, number>;
  explanation: string[];
  /** What differs from the main suggestion. */
  tradeoffs: string[];
  /** Menu deals used: what they save against buying the parts one by one. */
  deals: { name: string; saves: Bani }[];
}

export interface SmartResult {
  suggestions: SmartSuggestion[];
  /** Wishes that could not be honoured (product not on the menu, no budget). */
  unmet: string[];
  notes: string[];
  /** Products the user can pick preferences from. */
  catalog: { name: string; price: Bani; kind: ItemKind }[];
  reason?: string;
}

export interface BasketLine {
  itemId: string;
  name: string;
  /** Number of purchases. */
  qty: number;
  /** Units received (qty * unitsPerPurchase). */
  units: number;
  unitGrams: number;
  price: Bani;
  originalPrice?: Bani;
  lineTotal: Bani;
  lineGrams: number;
  kind: ItemKind;
  includes?: Includes;
  weightUncertain?: boolean;
  weightSource?: MenuItem["weightSource"];
}

export interface CostBreakdown {
  subtotal: Bani;
  discount: Bani;
  deliveryFee: Bani;
  serviceFee: Bani;
  smallOrderFee: Bani;
  total: Bani;
  /** The amount compared against the budget (depends on scope). */
  counted: Bani;
}

export interface Basket {
  lines: BasketLine[];
  /** Food only; the drink, if any, is not counted. */
  grams: number;
  cost: CostBreakdown;
  /** Lei per 100 g, based on the counted amount. */
  leiPer100g: number;
}

export interface OptimizeResult {
  /** Best basket within the budget, or null if nothing fits. */
  best: Basket | null;
  /** Flex mode: a basket slightly over budget with more food, if any. */
  stretch: Basket | null;
  reason?: string;
  smart?: SmartResult;
}

// lib/ingredientDB.ts
// Canonical ingredient catalog + fuzzy search + normalization.
// Purpose: map arbitrary pantry/LLM strings -> stable canonical IDs
// so pricing engines and planners can reason consistently.
//
// This file ships with an in-memory seed. You can later swap it to load
// from /data/ingredientSeed.json without changing callers.

export type PriceCategory =
  | "very_cheap"
  | "cheap"
  | "moderate"
  | "expensive"
  | "luxury";

export type UnitCanonical =
  | "unit"
  | "g"
  | "kg"
  | "ml"
  | "l"
  | "cup"
  | "tbsp"
  | "tsp"
  | "oz";

export type IngredientCanonical = {
  id: string;                // stable key: "milk_whole"
  name: string;              // display: "Milk, whole"
  aliases: string[];         // matching variants
  category: string;          // "dairy","produce","grain","protein","pantry","condiment","spice","oil"
  typicalUnit: UnitCanonical;
  typicalPackQty: number;    // 1 for unit, 1000 for ml/l/g etc
  priceCategory: PriceCategory;
  typicalPriceUSD?: number;  // optional seed price per typicalUnit
};

// ---------------- Normalization utilities ----------------

const STRIP_WORDS = [
  "fresh","frozen","canned","dried","dry","raw","large","small","medium",
  "boneless","skinless","organic","ripe","chopped","diced","minced","ground",
  "whole","reduced-fat","low-fat","nonfat","unsweetened","sweetened","plain",
  "unseasoned","seasoned","uncooked","cooked","sliced","shredded"
];

const PLURAL_MAP: Record<string, string> = {
  tomatoes: "tomato",
  potatoes: "potato",
  onions: "onion",
  cloves: "clove",
  cloves_of_garlic: "garlic",
  eggs: "egg",
  chilies: "chili",
  chiles: "chile",
  chickpeas: "chickpea",
  garbanzos: "chickpea",
  beans: "bean",
  apples: "apple",
  bananas: "banana",
  tortillas: "tortilla",
  buns: "bun",
  rolls: "roll",
  leaves: "leaf",
};

export function normalizeName(s: string): string {
  let t = (s || "")
    .toLowerCase()
    // remove punctuation except hyphen & slash
    .replace(/[.,()]/g, " ")
    .replace(/[^a-z0-9\-\/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // strip commodity adjectives
  for (const w of STRIP_WORDS) {
    t = t.replace(new RegExp(`\\b${w}\\b`, "g"), " ");
  }
  t = t.replace(/\s+/g, " ").trim();

  // simple plural folding
  const tokens = t.split(" ").map(tok => PLURAL_MAP[tok] ?? tok);
  return tokens.join(" ").trim();
}

function idFromName(name: string): string {
  return normalizeName(name).replace(/\s+/g, "_").replace(/[\/]/g, "_");
}

// Jaccard similarity over tokens
function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter || 1;
  return inter / union;
}

// ---------------- Seed catalog (expand later) ----------------

const SEED: IngredientCanonical[] = [
  // Dairy
  { id: "milk_whole", name: "Milk, whole", aliases: ["whole milk","milk"], category: "dairy", typicalUnit: "ml", typicalPackQty: 1000, priceCategory: "cheap", typicalPriceUSD: 4.0 },
  { id: "milk_2_percent", name: "Milk, 2%", aliases: ["2% milk","reduced-fat milk"], category: "dairy", typicalUnit: "ml", typicalPackQty: 1000, priceCategory: "cheap" },
  { id: "cheddar", name: "Cheddar cheese", aliases: ["cheddar","cheddar block","shredded cheddar"], category: "dairy", typicalUnit: "g", typicalPackQty: 227, priceCategory: "moderate" },
  { id: "mozzarella", name: "Mozzarella", aliases: ["mozzarella cheese"], category: "dairy", typicalUnit: "g", typicalPackQty: 227, priceCategory: "moderate" },
  { id: "yogurt_plain", name: "Yogurt, plain", aliases: ["plain yogurt","greek yogurt plain"], category: "dairy", typicalUnit: "g", typicalPackQty: 170, priceCategory: "cheap" },
  { id: "butter_unsalted", name: "Butter, unsalted", aliases: ["butter"], category: "dairy", typicalUnit: "g", typicalPackQty: 113, priceCategory: "moderate" },

  // Eggs & Protein
  { id: "egg", name: "Egg", aliases: ["eggs"], category: "protein", typicalUnit: "unit", typicalPackQty: 12, priceCategory: "cheap", typicalPriceUSD: 3.0 },
  { id: "chicken_breast", name: "Chicken breast", aliases: ["boneless skinless chicken breast","chicken"], category: "protein", typicalUnit: "g", typicalPackQty: 454, priceCategory: "moderate" },
  { id: "ground_beef_80", name: "Ground beef (80/20)", aliases: ["ground beef","minced beef"], category: "protein", typicalUnit: "g", typicalPackQty: 454, priceCategory: "moderate" },
  { id: "salmon_fillet", name: "Salmon fillet", aliases: ["salmon"], category: "protein", typicalUnit: "g", typicalPackQty: 454, priceCategory: "expensive" },
  { id: "tofu_firm", name: "Tofu, firm", aliases: ["tofu"], category: "protein", typicalUnit: "g", typicalPackQty: 397, priceCategory: "cheap" },
  { id: "tempeh", name: "Tempeh", aliases: ["soy tempeh"], category: "protein", typicalUnit: "g", typicalPackQty: 227, priceCategory: "moderate" },
  { id: "black_bean_canned", name: "Black beans (canned)", aliases: ["canned black beans","black bean"], category: "pantry", typicalUnit: "g", typicalPackQty: 439, priceCategory: "very_cheap" },
  { id: "chickpea_canned", name: "Chickpeas (canned)", aliases: ["garbanzo beans","canned chickpeas"], category: "pantry", typicalUnit: "g", typicalPackQty: 439, priceCategory: "very_cheap" },

  // Produce
  { id: "onion_yellow", name: "Onion, yellow", aliases: ["yellow onion","onion"], category: "produce", typicalUnit: "unit", typicalPackQty: 1, priceCategory: "very_cheap" },
  { id: "garlic", name: "Garlic", aliases: ["garlic clove","cloves of garlic"], category: "produce", typicalUnit: "unit", typicalPackQty: 1, priceCategory: "very_cheap" },
  { id: "tomato", name: "Tomato", aliases: ["tomatoes"], category: "produce", typicalUnit: "unit", typicalPackQty: 1, priceCategory: "cheap" },
  { id: "potato_russet", name: "Potato, russet", aliases: ["potato","russet potatoes"], category: "produce", typicalUnit: "unit", typicalPackQty: 1, priceCategory: "very_cheap" },
  { id: "spinach", name: "Spinach", aliases: ["baby spinach"], category: "produce", typicalUnit: "g", typicalPackQty: 142, priceCategory: "cheap" },
  { id: "broccoli", name: "Broccoli", aliases: ["broccoli crowns"], category: "produce", typicalUnit: "g", typicalPackQty: 300, priceCategory: "cheap" },
  { id: "bell_pepper", name: "Bell pepper", aliases: ["red bell pepper","green bell pepper","pepper bell"], category: "produce", typicalUnit: "unit", typicalPackQty: 1, priceCategory: "cheap" },
  { id: "carrot", name: "Carrot", aliases: ["carrots"], category: "produce", typicalUnit: "g", typicalPackQty: 100, priceCategory: "very_cheap" },
  { id: "apple", name: "Apple", aliases: ["apples"], category: "produce", typicalUnit: "unit", typicalPackQty: 1, priceCategory: "cheap" },
  { id: "banana", name: "Banana", aliases: ["bananas"], category: "produce", typicalUnit: "unit", typicalPackQty: 1, priceCategory: "very_cheap" },
  { id: "avocado", name: "Avocado", aliases: ["avocados"], category: "produce", typicalUnit: "unit", typicalPackQty: 1, priceCategory: "moderate" },
  { id: "cilantro", name: "Cilantro", aliases: ["coriander leaves"], category: "produce", typicalUnit: "g", typicalPackQty: 28, priceCategory: "cheap" },

  // Grains / Pasta / Bread
  { id: "rice_long_grain", name: "Rice, long-grain", aliases: ["rice","white rice"], category: "grain", typicalUnit: "g", typicalPackQty: 907, priceCategory: "very_cheap" },
  { id: "pasta_spaghetti", name: "Pasta, spaghetti", aliases: ["spaghetti","pasta"], category: "grain", typicalUnit: "g", typicalPackQty: 454, priceCategory: "very_cheap" },
  { id: "bread_sandwich", name: "Bread, sandwich", aliases: ["sandwich bread","white bread","whole wheat bread"], category: "grain", typicalUnit: "unit", typicalPackQty: 1, priceCategory: "cheap" },
  { id: "tortilla_flour", name: "Tortillas, flour", aliases: ["flour tortillas","tortilla"], category: "grain", typicalUnit: "unit", typicalPackQty: 10, priceCategory: "cheap" },
  { id: "oats_rolled", name: "Oats, rolled", aliases: ["rolled oats","oatmeal"], category: "grain", typicalUnit: "g", typicalPackQty: 907, priceCategory: "very_cheap" },

  // Pantry & Canned
  { id: "tomato_canned_crushed", name: "Crushed tomatoes (canned)", aliases: ["canned tomatoes","crushed tomatoes"], category: "pantry", typicalUnit: "g", typicalPackQty: 794, priceCategory: "very_cheap" },
  { id: "coconut_milk_canned", name: "Coconut milk (canned)", aliases: ["canned coconut milk"], category: "pantry", typicalUnit: "ml", typicalPackQty: 400, priceCategory: "moderate" },
  { id: "tuna_canned", name: "Tuna (canned)", aliases: ["canned tuna","tuna can"], category: "pantry", typicalUnit: "g", typicalPackQty: 142, priceCategory: "cheap" },
  { id: "peanut_butter", name: "Peanut butter", aliases: ["pb"], category: "pantry", typicalUnit: "g", typicalPackQty: 454, priceCategory: "cheap" },

  // Oils / Condiments / Spices
  { id: "olive_oil", name: "Olive oil", aliases: ["extra virgin olive oil","evoo"], category: "oil", typicalUnit: "ml", typicalPackQty: 500, priceCategory: "expensive" },
  { id: "vegetable_oil", name: "Vegetable oil", aliases: ["canola oil"], category: "oil", typicalUnit: "ml", typicalPackQty: 946, priceCategory: "cheap" },
  { id: "soy_sauce", name: "Soy sauce", aliases: ["shoyu"], category: "condiment", typicalUnit: "ml", typicalPackQty: 296, priceCategory: "cheap" },
  { id: "hot_sauce", name: "Hot sauce", aliases: ["chili sauce"], category: "condiment", typicalUnit: "ml", typicalPackQty: 148, priceCategory: "cheap" },
  { id: "salt_kosher", name: "Salt, kosher", aliases: ["salt"], category: "spice", typicalUnit: "g", typicalPackQty: 1000, priceCategory: "very_cheap" },
  { id: "black_pepper", name: "Black pepper", aliases: ["pepper black","ground black pepper"], category: "spice", typicalUnit: "g", typicalPackQty: 50, priceCategory: "cheap" },
  { id: "cumin_ground", name: "Cumin, ground", aliases: ["ground cumin"], category: "spice", typicalUnit: "g", typicalPackQty: 44, priceCategory: "cheap" },
  { id: "paprika", name: "Paprika", aliases: ["smoked paprika"], category: "spice", typicalUnit: "g", typicalPackQty: 50, priceCategory: "cheap" },

  // Misc
  { id: "coffee_ground", name: "Coffee, ground", aliases: ["ground coffee"], category: "pantry", typicalUnit: "g", typicalPackQty: 340, priceCategory: "expensive" },
  { id: "sugar_granulated", name: "Sugar, granulated", aliases: ["white sugar","granulated sugar"], category: "pantry", typicalUnit: "g", typicalPackQty: 1814, priceCategory: "very_cheap" },
  { id: "flour_all_purpose", name: "Flour, all-purpose", aliases: ["ap flour","all purpose flour"], category: "pantry", typicalUnit: "g", typicalPackQty: 1814, priceCategory: "very_cheap" },
];

// Build indices
const CATALOG: IngredientCanonical[] = SEED.map(e => ({ ...e, id: e.id || idFromName(e.name) }));
const ID_INDEX = new Map(CATALOG.map(e => [e.id, e]));
const NAME_INDEX = new Map<string, string>(); // normalized alias -> id

for (const item of CATALOG) {
  const base = normalizeName(item.name);
  NAME_INDEX.set(base, item.id);
  for (const a of item.aliases || []) {
    NAME_INDEX.set(normalizeName(a), item.id);
  }
}

// ---------------- Public API ----------------

export function getCatalog(): IngredientCanonical[] {
  return CATALOG;
}

export function getById(id: string): IngredientCanonical | undefined {
  return ID_INDEX.get(id);
}

export type CanonicalMatch = {
  id: string;
  matched: string;    // alias or name that matched
  confidence: number; // 0..1
};

export function canonicalize(term: string): CanonicalMatch | null {
  const raw = term || "";
  const norm = normalizeName(raw);
  if (!norm) return null;

  // direct alias/name hit
  const direct = NAME_INDEX.get(norm);
  if (direct) {
    return { id: direct, matched: norm, confidence: 0.99 };
  }

  // fuzzy: score against all aliases/names
  const tokensQ = norm.split(" ").filter(Boolean);
  let best: { id: string; score: number; matched: string } | null = null;

  for (const [aliasNorm, id] of NAME_INDEX.entries()) {
    const score = jaccard(tokensQ, aliasNorm.split(" ").filter(Boolean));
    if (!best || score > best.score) best = { id, score, matched: aliasNorm };
  }

  if (best && best.score >= 0.35) {
    return { id: best.id, matched: best.matched, confidence: Math.min(0.95, best.score) };
  }

  // fallback: try substring containment (weak)
  for (const [aliasNorm, id] of NAME_INDEX.entries()) {
    if (aliasNorm.includes(norm) || norm.includes(aliasNorm)) {
      return { id, matched: aliasNorm, confidence: 0.4 };
    }
  }

  return null;
}

export function searchIngredients(
  query: string,
  opts?: { limit?: number; category?: string }
): IngredientCanonical[] {
  const q = normalizeName(query);
  if (!q) return [];
  const toks = q.split(" ").filter(Boolean);
  const scored = CATALOG.map((item) => {
    const candidates = [item.name, ...(item.aliases || [])].map(normalizeName);
    const score = Math.max(
      ...candidates.map(c => jaccard(toks, c.split(" ").filter(Boolean)))
    );
    return { item, score };
  })
    .filter(x => x.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);

  const filtered = opts?.category
    ? scored.filter(i => i.category === opts!.category)
    : scored;

  return filtered.slice(0, Math.max(1, opts?.limit ?? 12));
}

// Optional: helper to compute a friendly label for units
export function formatTypical(itemId: string): string | null {
  const it = ID_INDEX.get(itemId);
  if (!it) return null;
  const u = it.typicalUnit;
  const q = it.typicalPackQty;
  if (u === "unit") return `each (x${q})`;
  return `${q}${u}`;
}

// --------------- Future: load from JSON ---------------
// If/when you move to external data, keep the same exports and swap SEED:
// import seed from "../data/ingredientSeed.json";
// const SEED: IngredientCanonical[] = seed as IngredientCanonical[];

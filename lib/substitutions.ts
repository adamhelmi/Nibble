// lib/substitutions.ts
// Query engine for ingredient substitutions with preference filtering.
// Backed by global Prefs from lib/prefs.

import raw from "../data/substitutions.json";
import { normalize as normName } from "./livePricing";
import type { Prefs, Diet } from "./prefs";
import { DEFAULT_PREFS } from "./prefs";

export type SubRow = {
  name: string;
  notes?: string;
  tags?: string[]; // e.g., ["vegan","dairy-free","nut","gluten","soy","poultry","dairy"]
};

export type SubEntry = {
  key: string;         // canonical source ingredient
  aliases?: string[];  // alternate names for matching
  subs: SubRow[];
};

// Load and index
const DATA: SubEntry[] = raw as unknown as SubEntry[];

type Index = {
  byKey: Map<string, SubEntry>;
  aliasToKey: Map<string, string>;
};

const IDX: Index = (() => {
  const byKey = new Map<string, SubEntry>();
  const aliasToKey = new Map<string, string>();

  for (const entry of DATA) {
    const k = norm(entry.key);
    byKey.set(k, entry);

    // Root and explicit aliases → root key
    aliasToKey.set(k, k);
    for (const a of entry.aliases ?? []) {
      aliasToKey.set(norm(a), k);
    }

    // Reverse-alias all substitute names back to root key (enables chaining)
    for (const sub of entry.subs) {
      aliasToKey.set(norm(sub.name), k);
    }
  }

  return { byKey, aliasToKey };
})();

function norm(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/\b(fresh|chopped|diced|minced|boneless|skinless|large|small|organic)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normName(cleaned);
}

/** ---------------- Diet & Rule Semantics ---------------- **/

// Diet → forbidden tags (include every Diet in the union)
const DIET_BLOCK_TAGS: Record<Diet, string[]> = {
  omnivore: [],
  vegetarian: ["meat", "fish", "shellfish", "poultry", "pork", "beef", "gelatin"],
  vegan: ["meat", "fish", "shellfish", "poultry", "pork", "beef", "dairy", "egg", "honey", "gelatin"],
  pescatarian: ["meat", "poultry", "pork", "beef", "gelatin"],
  keto: [],   // nutritional constraints handled elsewhere
  paleo: [],  // same idea
};

// Religious rule → forbidden tags (coarse; certification is out-of-scope here)
const RELIGIOUS_BLOCKS: Record<NonNullable<Prefs["religious"]>, string[]> = {
  none: [],
  halal: ["pork", "alcohol", "gelatin"], // conservative; cannot assert halal certification
  kosher: ["pork", "shellfish"], // no meat-dairy mix not modelled here
};

// Allergen synonyms normalization (coarse but useful)
const ALLERGEN_SYNONYMS: Record<string, string[]> = {
  dairy: ["milk", "butter", "cheese", "yogurt", "whey", "casein"],
  gluten: ["wheat", "barley", "rye", "semolina"],
  nut: ["peanut", "tree nut", "almond", "walnut", "pecan", "hazelnut", "pistachio", "cashew"],
  peanut: ["peanut"],
  "tree nut": ["almond", "walnut", "pecan", "hazelnut", "pistachio", "cashew"],
  soy: ["soy", "soya", "tofu", "edamame", "soybean"],
  egg: ["egg", "albumen", "mayonnaise"],
  shellfish: ["shrimp", "prawn", "lobster", "crab", "crustacean"],
  fish: ["salmon", "tuna", "cod", "anchovy", "sardine"],
  sesame: ["tahini", "sesame"],
};

function expandAllergens(allergens: string[] = []): string[] {
  const out = new Set<string>();
  for (const a of allergens) {
    const k = a.toLowerCase();
    out.add(k);
    for (const syn of ALLERGEN_SYNONYMS[k] ?? []) out.add(syn);
  }
  return Array.from(out);
}

/** ---------------- Helpers ---------------- **/

function tagHasAny(tags: string[] | undefined, needles: string[]): boolean {
  if (!tags || needles.length === 0) return false;
  const set = new Set(tags.map(t => t.toLowerCase()));
  return needles.some(n => set.has(n.toLowerCase()));
}

function nameContainsAny(name: string, terms: string[] = []): boolean {
  const low = name.toLowerCase();
  return terms.some(t => low.includes(String(t).toLowerCase()));
}

// Prefer positive compliance tags if present; otherwise infer “friendly”
function reasonTagsFor(sub: SubRow, p: Prefs): string[] {
  const tags = (sub.tags ?? []).map(t => t.toLowerCase());
  const rt: string[] = [];

  // Diet compliance (positive)
  if (p.diet === "vegan" && (tags.includes("vegan") || !tagHasAny(tags, DIET_BLOCK_TAGS.vegan))) rt.push("vegan");
  else if (p.diet === "vegetarian" && (tags.includes("vegetarian") || !tagHasAny(tags, DIET_BLOCK_TAGS.vegetarian))) rt.push("vegetarian");
  else if (p.diet === "pescatarian" && !tagHasAny(tags, ["meat", "poultry", "pork", "beef"])) rt.push("pescatarian");

  // Religious compliance (friendly, not certified)
  if (p.religious === "halal" && !tagHasAny(tags, RELIGIOUS_BLOCKS.halal)) rt.push("halal-friendly");
  if (p.religious === "kosher" && !tagHasAny(tags, RELIGIOUS_BLOCKS.kosher)) rt.push("kosher-friendly");

  // Allergen-safe (approx)
  const allergenBlocks = expandAllergens(p.allergens);
  if (allergenBlocks.length) {
    const intersects = tagHasAny(tags, allergenBlocks) || nameContainsAny(sub.name, allergenBlocks);
    if (!intersects) rt.push("allergen-safe");
  }

  // Dislike-aware
  if ((p.dislikes ?? []).length && !nameContainsAny(sub.name, p.dislikes ?? [])) {
    rt.push("dislike-avoid");
  }

  return Array.from(new Set(rt));
}

function rationaleFor(sub: SubRow, p: Prefs, sourceKey: string): string {
  const rt = reasonTagsFor(sub, p);
  const parts: string[] = [];

  if (rt.includes("vegan")) parts.push("fits vegan");
  if (rt.includes("vegetarian")) parts.push("fits vegetarian");
  if (rt.includes("pescatarian")) parts.push("fits pescatarian");

  if (rt.includes("halal-friendly")) parts.push("avoids pork/alcohol/gelatin");
  if (rt.includes("kosher-friendly")) parts.push("avoids pork/shellfish");

  if (rt.includes("allergen-safe") && (p.allergens?.length ?? 0) > 0) {
    parts.push(`free of ${p.allergens.join(", ")}`);
  }
  if (rt.includes("dislike-avoid") && (p.dislikes?.length ?? 0) > 0) {
    parts.push("avoids your dislikes");
  }

  // Fallback if no tag was detected (still valid suggestion after filters)
  if (parts.length === 0) {
    parts.push(`compatible alternative to ${sourceKey}`);
  }
  return parts.join("; ");
}

/** ---------------- Public API ---------------- **/

export type SubResult = {
  name: string;
  notes?: string;
  tags?: string[];
  score: number;
  /** New: short classifier tags e.g. ["vegan","halal-friendly","allergen-safe"] */
  reasonTags?: string[];
  /** New: a brief human-readable summary of why this is suggested */
  rationale?: string;
};

/** Return canonical key for a term or undefined if no match. */
export function resolveKey(term: string): string | undefined {
  const n = norm(term);
  return IDX.aliasToKey.get(n);
}

/** Convenience: check if we have substitutions for term */
export function hasSubstitutions(term: string): boolean {
  return resolveKey(term) !== undefined;
}

/**
 * Get substitutions for a term, filtered by user preferences.
 * Accepts Partial<Prefs>; merges with DEFAULT_PREFS to satisfy required fields.
 * Returns 3–5 top results by score, with reason tags and rationale.
 */
export function getSubstitutions(
  term: string,
  prefs?: Partial<Prefs>
): SubResult[] {
  const key = resolveKey(term);
  if (!key) return [];

  const entry = IDX.byKey.get(key)!;
  const p: Prefs = { ...DEFAULT_PREFS, ...(prefs ?? {}) };

  const diet = p.diet ?? "omnivore";
  const dietBlocks = DIET_BLOCK_TAGS[diet] ?? [];

  // Religious rule filter list
  const religiousBlocks = RELIGIOUS_BLOCKS[p.religious ?? "none"] ?? [];

  // Allergen blocklist (expanded with synonyms)
  const allergenBlocks = expandAllergens(p.allergens ?? []);

  const results: SubResult[] = [];
  entry.subs.forEach((s, idx) => {
    const tags = (s.tags ?? []).map(t => t.toLowerCase());
    const name = s.name ?? "";

    // HARD filters — reject immediately
    // Diet filter
    if (tagHasAny(tags, dietBlocks)) return;
    // Religious rule filter
    if (tagHasAny(tags, religiousBlocks)) return;
    // Allergen filter (tags or name match)
    if (tagHasAny(tags, allergenBlocks) || nameContainsAny(name, allergenBlocks)) return;
    // Dislikes filter (SOFT in scoring, but we avoid direct hits entirely)
    if (nameContainsAny(name, p.dislikes ?? [])) return;

    // Scoring: baseline from dataset order; nudge toward compliance signals
    let score = 1000 - idx;

    // Positive nudges
    if (p.diet === "vegan" && (tags.includes("vegan") || !tagHasAny(tags, DIET_BLOCK_TAGS.vegan))) score += 6;
    if (p.diet === "vegetarian" && (tags.includes("vegetarian") || !tagHasAny(tags, DIET_BLOCK_TAGS.vegetarian))) score += 4;
    if (p.religious === "halal" && !tagHasAny(tags, religiousBlocks)) score += 3;
    if (p.religious === "kosher" && !tagHasAny(tags, religiousBlocks)) score += 3;

    // Allergen-safe nudges
    if (allergenBlocks.length && !(tagHasAny(tags, allergenBlocks) || nameContainsAny(name, allergenBlocks))) score += 3;

    // Spice tolerance: penalize “spicy” for low tolerance
    if ((p.spiceTolerance ?? 1) === 0 && tags.includes("spicy")) score -= 2;

    const reasonTags = reasonTagsFor(s, p);
    const rationale = rationaleFor(s, p, key);

    results.push({ name, notes: s.notes, tags: s.tags, score, reasonTags, rationale });
  });

  results.sort((a, b) => b.score - a.score);
  // Trim to 3–5 strong suggestions for UX clarity
  return results.slice(0, 5);
}




// lib/substitutions.ts
// Query engine for ingredient substitutions with preference filtering.

import raw from "../data/substitutions.json";
import { normalize as normName } from "./livePricing";

type Diet = "omnivore" | "vegetarian" | "vegan";
export type Prefs = {
  diet?: Diet;
  allergens?: string[];   // e.g., ["nut", "soy", "gluten", "dairy"]
  dislikes?: string[];    // free-text words to avoid in names
};

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

    // ⬇️ NEW: reverse-alias all substitute names back to the root key.
    // This enables chaining: after "milk → oat milk", tapping "oat milk" still resolves to "milk".
    for (const sub of entry.subs) {
      aliasToKey.set(norm(sub.name), k);
    }
  }

  return { byKey, aliasToKey };
})();

function norm(s: string): string {
  // mirror app-side heuristics (strip descriptors, lowercase, collapse spaces)
  const cleaned = s
    .toLowerCase()
    .replace(/\b(fresh|chopped|diced|minced|boneless|skinless|large|small|organic)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normName(cleaned);
}

// Diet → forbidden tags
const DIET_BLOCK_TAGS: Record<Diet, string[]> = {
  omnivore: [],
  vegetarian: ["meat", "fish", "shellfish", "poultry", "pork", "beef", "gelatin"],
  vegan: ["meat", "fish", "shellfish", "poultry", "pork", "beef", "dairy", "egg", "honey", "gelatin"]
};

function tagHasAny(tags: string[] | undefined, needles: string[]): boolean {
  if (!tags || needles.length === 0) return false;
  const set = new Set(tags.map(t => t.toLowerCase()));
  return needles.some(n => set.has(n.toLowerCase()));
}

function nameContainsAny(name: string, terms: string[] = []): boolean {
  const low = name.toLowerCase();
  return terms.some(t => low.includes(t.toLowerCase()));
}

export type SubResult = { name: string; notes?: string; tags?: string[]; score: number };

/**
 * Get substitutions for a term, filtered by user preferences.
 * Ordering is stable: JSON order first, then simple scoring tweaks.
 */
export function getSubstitutions(
  term: string,
  prefs: Prefs = {}
): SubResult[] {
  const key = resolveKey(term);
  if (!key) return [];

  const entry = IDX.byKey.get(key)!;
  const diet = prefs.diet ?? "omnivore";
  const dietBlocks = DIET_BLOCK_TAGS[diet];

  const allergenBlocks = (prefs.allergens ?? []).map(a => a.toLowerCase());

  const results: SubResult[] = [];
  entry.subs.forEach((s, idx) => {
    const tags = (s.tags ?? []).map(t => t.toLowerCase());

    // Diet filter
    if (tagHasAny(tags, dietBlocks)) return;

    // Allergen filter (treat "nuts" as "nut", etc.)
    if (tagHasAny(tags, allergenBlocks)) return;

    // Dislikes filter
    if (nameContainsAny(s.name, prefs.dislikes)) return;

    // Simple scoring: keep dataset order, lightly prefer diet-aligned tags
    let score = 1000 - idx;
    if (tags.includes("vegan") && diet === "vegan") score += 5;
    if (tags.includes("dairy-free") && allergenBlocks.includes("dairy")) score += 3;
    if (tags.includes("soy-free") && allergenBlocks.includes("soy")) score += 2;
    if (tags.includes("gluten-free") && allergenBlocks.includes("gluten")) score += 2;

    results.push({ name: s.name, notes: s.notes, tags: s.tags, score });
  });

  // sort by score desc, preserve stable order for ties
  results.sort((a, b) => b.score - a.score);
  return results;
}

/** Return canonical key for a term or undefined if no match. */
export function resolveKey(term: string): string | undefined {
  const n = norm(term);
  return IDX.aliasToKey.get(n);
}

/** Convenience: check if we have substitutions for term */
export function hasSubstitutions(term: string): boolean {
  return resolveKey(term) !== undefined;
}

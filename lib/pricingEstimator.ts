// lib/pricingEstimator.ts
// Deterministic ingredient price estimation with confidence + caching.
// Hierarchy:
//  1️⃣ Canonical ingredient seed price (if present)
//  2️⃣ Category → heuristic table
//  3️⃣ Optional AI fallback (if explicitly enabled)
//  Returns USD per typicalUnit with confidence and source.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getById, canonicalize, type IngredientCanonical } from "./ingredientDB";

export type PriceEstimate = {
  amount: number; // USD per typicalUnit
  unit: string;
  source: "seed" | "heuristic" | "ai" | "unknown";
  confidence: number; // 0..1
  note?: string;
};

export type CachedEntry = PriceEstimate & { ts: number };

// ---- Heuristic baselines per category ----
const HEURISTIC_RANGES: Record<string, { min: number; max: number; median: number }> = {
  produce: { min: 0.5, max: 3, median: 1.5 },
  dairy: { min: 1, max: 5, median: 3 },
  protein: { min: 2, max: 8, median: 4 },
  grain: { min: 0.5, max: 2, median: 1 },
  pantry: { min: 1, max: 4, median: 2 },
  oil: { min: 2, max: 6, median: 4 },
  condiment: { min: 1, max: 4, median: 2 },
  spice: { min: 1, max: 6, median: 3 },
};

// ---- Price category multiplier ----
const CATEGORY_MULTIPLIER: Record<string, number> = {
  very_cheap: 0.5,
  cheap: 0.8,
  moderate: 1,
  expensive: 1.4,
  luxury: 2,
};

const CACHE_KEY = "nibble_pricecache_v1";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// ---- Load + Save Cache ----
async function loadCache(): Promise<Record<string, CachedEntry>> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveCache(cache: Record<string, CachedEntry>) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

// ---- Core Estimation ----
export async function getPriceEstimate(
  term: string,
  opts?: { useAI?: boolean }
): Promise[PriceEstimate] {
  const cache = await loadCache();
  const norm = canonicalize(term);

  const id = norm?.id ?? `unmapped:${term.toLowerCase()}`;
  const now = Date.now();

  // 1️⃣ Cached?
  const cached = cache[id];
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached;

  // 2️⃣ Canonical seed
  const item: IngredientCanonical | undefined = norm ? getById(norm.id) : undefined;
  if (item && item.typicalPriceUSD) {
    const val: PriceEstimate = {
      amount: item.typicalPriceUSD,
      unit: item.typicalUnit,
      source: "seed",
      confidence: 0.9,
    };
    cache[id] = { ...val, ts: now };
    await saveCache(cache);
    return val;
  }

  // 3️⃣ Heuristic category fallback
  if (item) {
    const base = HEURISTIC_RANGES[item.category] ?? { min: 1, max: 3, median: 2 };
    const mult = CATEGORY_MULTIPLIER[item.priceCategory] ?? 1;
    const amount = +(base.median * mult).toFixed(2);

    const val: PriceEstimate = {
      amount,
      unit: item.typicalUnit,
      source: "heuristic",
      confidence: 0.65,
    };
    cache[id] = { ...val, ts: now };
    await saveCache(cache);
    return val;
  }

  // 4️⃣ Optional AI fallback (rarely used — slower)
  if (opts?.useAI) {
    try {
      const val = await aiEstimate(term);
      cache[id] = { ...val, ts: now };
      await saveCache(cache);
      return val;
    } catch {
      /* ignore */
    }
  }

  // 5️⃣ Fallback unknown
  const val: PriceEstimate = {
    amount: 2,
    unit: "unit",
    source: "unknown",
    confidence: 0.2,
    note: "unmapped",
  };
  cache[id] = { ...val, ts: now };
  await saveCache(cache);
  return val;
}

// ---- AI fallback (local prompt, optional) ----
async function aiEstimate(term: string): Promise<PriceEstimate> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.1:8b",
        prompt: `Estimate realistic U.S. grocery price for "${term}". 
Return ONLY JSON { "amount": number, "unit": string, "confidence": 0..1 } with price in USD per typical grocery unit.`,
        format: "json",
        stream: false,
      }),
    });
    const data = await res.json();
    const jsonStr = data?.response ?? "{}";
    const obj = JSON.parse(jsonStr);
    return {
      amount: Number(obj.amount) || 2,
      unit: obj.unit || "unit",
      confidence: Math.max(0.3, Math.min(1, Number(obj.confidence) || 0.5)),
      source: "ai",
    };
  } catch {
    return { amount: 2, unit: "unit", source: "unknown", confidence: 0.2 };
  }
}

// ---- Batch helper for planner ----
export async function getBatchEstimates(
  ingredients: string[]
): Promise<Record<string, PriceEstimate>> {
  const out: Record<string, PriceEstimate> = {};
  for (const ing of ingredients) {
    out[ing] = await getPriceEstimate(ing);
  }
  return out;
}

// ---- Utility for clearing cache ----
export async function clearPriceCache() {
  await AsyncStorage.removeItem(CACHE_KEY);
}

/** =======================
 *  V2: recipe cost wrapper
 *  ======================= */
export type CostEstimate = { costUSD: number; confidence: "low" | "med" | "high" };

export function regionalMultiplier(zip?: string) {
  if (!zip) return 1.0;
  const prefix = zip.slice(0, 2);
  const map: Record<string, number> = {
    "10": 1.08, // NYC-ish bump
    "90": 1.10, // West Coast bump
    "60": 0.95, // Midwest relief
    "45": 0.92, // OH/KY demo case
  };
  return map[prefix] ?? 1.0;
}

/**
 * Wrap any base estimator (if you have one on global or otherwise) into a richer cost with region+confidence.
 * If no base is provided, we return a safe heuristic (~$6).
 */
export function estimateRecipeCostV2(
  ingredients: { name: string; qty?: number; unit?: string }[],
  zip?: string
): CostEstimate {
  // If you previously hung an estimator on global, respect it
  const base = (global as any)?.estimateRecipeCostUSD
    ? (global as any).estimateRecipeCostUSD(ingredients)
    : 6.0;

  const mul = regionalMultiplier(zip);
  const cost = Number((base * mul).toFixed(2));

  const coverage =
    ingredients.length === 0
      ? 0
      : ingredients.filter((i) => !!i.unit).length / ingredients.length;

  const confidence: "low" | "med" | "high" =
    coverage >= 0.7 ? "high" : coverage >= 0.4 ? "med" : "low";

  return { costUSD: cost, confidence };
}

// lib/scorePlan.ts
// Deterministic scoring for weekly meal planning.
// Pure functions only. No React. No storage. UI-agnostic.

export type PlanRecipe = {
  id: string;                   // stable key for variety checks
  title: string;
  minutes: number;              // prep/cook time
  cost: number;                 // total meal cost (est.) in USD
  ingredients?: string[];       // optional, used for reuse/variety heuristics
  tags?: string[];              // optional (e.g., ["vegan","italian","chicken"])
};

export type TimeWindow = "any" | "le45" | "le30";

export type PlanConstraints = {
  budgetCapUSD?: number | null; // weekly target; soft cap (penalize overage)
  dayWindows?: Record<number, TimeWindow>; // 0-6 → time window
  pantryItems?: string[];       // for reuse bonus
  forbidTerms?: string[];       // “hard” blocks (diet/allergens/religious)
};

export type ScoreWeights = {
  weightCost: number;           // [0..1] cost vs time trade-off; 1 = prioritize cheaper
  weightTime: number;           // derived as 1-weightCost in most usages
  reuseBonus: number;           // boost for using pantry items
  varietyPenalty: number;       // penalty for repeating same “token”
  overBudgetPenalty: number;    // weekly penalty per $ over budget
  windowPenalty: number;        // per-day penalty if minutes violates window
};

export type DayPick = { recipe: PlanRecipe; score: number };
export type WeekResult = {
  days: DayPick[];              // 7 entries
  totals: { costUSD: number; minutes: number };
  summary: { reuseHits: number; varietyScore: number };
  scoreSum: number;
};

// -------------------- helpers --------------------

function norm01(x: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  const n = (x - min) / (max - min);
  return Math.max(0, Math.min(1, n));
}

function tokenize(str: string): string[] {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function hasForbiddenTerms(texts: string[], forbid: string[] = []): boolean {
  if (!forbid?.length) return false;
  const bag = new Set(tokenize(texts.join(" ")));
  for (const f of forbid) {
    const t = f.toLowerCase().trim();
    if (bag.has(t)) return true;
  }
  return false;
}

function windowOK(minutes: number, w: TimeWindow): boolean {
  if (w === "le30") return minutes <= 30;
  if (w === "le45") return minutes <= 45;
  return true; // any
}

function reuseCount(ingredients: string[] = [], pantry: string[] = []): number {
  if (!ingredients.length || !pantry.length) return 0;
  const P = new Set(pantry.map(s => s.toLowerCase()));
  let hits = 0;
  for (const ing of ingredients) {
    if (P.has(ing.toLowerCase())) hits++;
  }
  return hits;
}

function varietyKey(r: PlanRecipe): string {
  // heuristic: prefer cuisine/protein tokens if available; else first noun tokens from title
  const tags = r.tags?.filter(Boolean) ?? [];
  if (tags.length) return tags.join("|");
  const toks = tokenize(r.title);
  return toks.slice(0, 3).join("|");
}

// -------------------- scoring --------------------

export function scoreDayCandidate(
  r: PlanRecipe,
  bounds: { minCost: number; maxCost: number; minTime: number; maxTime: number },
  weights: ScoreWeights,
  constraints: PlanConstraints,
  dayIndex: number
): number {
  // Hard blocks first (diet/allergen/religious)
  if (hasForbiddenTerms(
      [r.title, ...(r.ingredients ?? []), ...(r.tags ?? [])],
      constraints.forbidTerms
    )) return -1e6;

  // Core axes
  const costN = 1 - norm01(r.cost, bounds.minCost, bounds.maxCost); // lower cost → higher score
  const timeN = 1 - norm01(r.minutes, bounds.minTime, bounds.maxTime); // lower time → higher score

  // Time window penalty
  const w = constraints.dayWindows?.[dayIndex] ?? "any";
  const windowOk = windowOK(r.minutes, w);
  const windowPenalty = windowOk ? 0 : weights.windowPenalty;

  // Pantry reuse bonus (scaled by count)
  const reuse = reuseCount(r.ingredients, constraints.pantryItems);
  const reuseBonus = reuse * weights.reuseBonus;

  return (weights.weightCost * costN) +
         (weights.weightTime * timeN) +
         reuseBonus -
         windowPenalty;
}

// Greedy week selection with variety control
export function pickWeek(
  pool: PlanRecipe[],
  weights: ScoreWeights,
  constraints: PlanConstraints
): WeekResult {
  if (!pool.length) {
    return { days: [], totals: { costUSD: 0, minutes: 0 }, summary: { reuseHits: 0, varietyScore: 0 }, scoreSum: 0 };
  }
  const minCost = Math.min(...pool.map(p => p.cost));
  const maxCost = Math.max(...pool.map(p => p.cost));
  const minTime = Math.min(...pool.map(p => p.minutes));
  const maxTime = Math.max(...pool.map(p => p.minutes));

  const chosen: DayPick[] = [];
  const seenVariety = new Map<string, number>(); // key → count
  let reuseHits = 0;

  for (let day = 0; day < 7; day++) {
    let best: DayPick | null = null;

    for (const r of pool) {
      let s = scoreDayCandidate(r, { minCost, maxCost, minTime, maxTime }, weights, constraints, day);
      if (s < -1e5) continue; // hard blocked

      // Variety penalty scaled by repeats
      const vk = varietyKey(r);
      const repeats = seenVariety.get(vk) ?? 0;
      s -= repeats * weights.varietyPenalty;

      if (!best || s > best.score) best = { recipe: r, score: s };
    }

    if (!best) {
      // fallback: any cheapest-safe recipe to fill the slot
      const safe = pool
        .filter(r => !hasForbiddenTerms([r.title, ...(r.ingredients ?? [])], constraints.forbidTerms))
        .sort((a, b) => a.cost - b.cost)[0];
      const pick = safe ?? pool[0];
      chosen.push({ recipe: pick, score: -999 });
      continue;
    }

    chosen.push(best);
    const vk = varietyKey(best.recipe);
    seenVariety.set(vk, (seenVariety.get(vk) ?? 0) + 1);
    reuseHits += reuseCount(best.recipe.ingredients, constraints.pantryItems);
  }

  const totals = {
    costUSD: +chosen.reduce((t, d) => t + (d.recipe.cost || 0), 0).toFixed(2),
    minutes: Math.round(chosen.reduce((t, d) => t + (d.recipe.minutes || 0), 0)),
  };

  // Weekly over-budget penalty (soft)
  if (constraints.budgetCapUSD && totals.costUSD > constraints.budgetCapUSD) {
    const over = totals.costUSD - constraints.budgetCapUSD;
    // We don’t mutate per-day scores post-hoc; we return the sum with penalty for reporting.
    const penalty = over * weights.overBudgetPenalty;
    return {
      days: chosen,
      totals,
      summary: { reuseHits, varietyScore: -penalty },
      scoreSum: chosen.reduce((t, d) => t + d.score, 0) - penalty,
    };
  }

  return {
    days: chosen,
    totals,
    summary: { reuseHits, varietyScore: 0 },
    scoreSum: chosen.reduce((t, d) => t + d.score, 0),
  };
}

// Utility to recompute week score given an existing 7-day plan (after swaps/edits)
export function rescoreWeek(
  week: PlanRecipe[],
  weights: ScoreWeights,
  constraints: PlanConstraints
): WeekResult {
  const wrapped = pickWeek(week, weights, constraints);
  // Use the existing order; just recompute meta
  return {
    ...wrapped,
    days: week.map((r, i) => ({ recipe: r, score: wrapped.days[i]?.score ?? 0 })),
  };
}

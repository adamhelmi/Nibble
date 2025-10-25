// lib/mealPlanner.ts
// Slot-aware weekly planner with progressive fallback to guarantee full weeks.

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'dessert';

export type Candidate = {
  id: string;
  title: string;
  minutes: number;          // prep + cook
  costUSD: number;          // total recipe cost (estimated ok)
  ingredients: string[];
  steps?: string[];
  tags?: string[];          // e.g., ["slot:dinner","prot:chicken","cuisine:it"]
  coverage?: number;        // pricing coverage 0..1
  priceConfidence?: number; // 0..1
};

export type PlanRecipe = {
  id: string;
  title: string;
  minutes: number;
  costUSD: number;
  ingredients: string[];
  steps?: string[];
};

export type DaySlot = {
  dayIndex: number;
  slot: MealSlot;
  recipe: PlanRecipe;
};

export type Plan = {
  slots: DaySlot[]; // flattened over days
  summary: {
    days: number;
    slotsPerDay: number;
    totalCostUSD: number;
    avgMinutes: number;
    avgCoverage: number;
    avgPriceConfidence: number;
    costIsEstimate: boolean; // true when average coverage < 0.7
  };
};

// ---------- Slot intent ----------

function tags(c: Candidate) { return c.tags || []; }

function hasAnySlotTag(c: Candidate) {
  return tags(c).some(t => t.startsWith('slot:'));
}

function hasSlotTag(c: Candidate, slot: MealSlot): boolean {
  const t = tags(c);
  const want = `slot:${slot}`;
  if (!t.some(x => x.startsWith('slot:'))) {
    // Default: untagged are safe for lunch/dinner (not breakfast/snack/dessert).
    return slot === 'lunch' || slot === 'dinner';
  }
  return t.includes(want);
}

// Fallback slot compatibility ladder when pools are thin.
function isSlotCompatibleWithFallback(c: Candidate, slot: MealSlot, phase: number): boolean {
  // phase 0: exact slot
  if (phase === 0) return hasSlotTag(c, slot);

  // phase 1: broaden within sensible neighbors
  // - breakfast: breakfast OR snack
  // - lunch: lunch OR dinner OR untagged
  // - dinner: dinner OR lunch OR untagged
  // - snack: snack OR breakfast OR lunch
  // - dessert: dessert OR snack
  const t = tags(c);
  const is = (s: MealSlot) => hasSlotTag(c, s);
  const untagged = !hasAnySlotTag(c);

  switch (slot) {
    case 'breakfast': return is('breakfast') || is('snack');
    case 'lunch':     return is('lunch') || is('dinner') || untagged;
    case 'dinner':    return is('dinner') || is('lunch') || untagged;
    case 'snack':     return is('snack') || is('breakfast') || is('lunch');
    case 'dessert':   return is('dessert') || is('snack');
  }
}

// ---------- Diversity helpers ----------

function getKeySet(c: Candidate) {
  const t = tags(c);
  const protein = t.find(x => x.startsWith('prot:')) || 'prot:none';
  const cuisine = t.find(x => x.startsWith('cuisine:')) || 'cuisine:gen';
  const family = `${protein}|${cuisine}`;
  return { protein, cuisine, family };
}

function diversityPenalty(
  c: Candidate,
  usedFamilies: Map<string, number>,
  diversityWeight: number
): number {
  const { family } = getKeySet(c);
  const count = usedFamilies.get(family) || 0;
  return diversityWeight * count * 0.35;
}

// ---------- Math ----------

function range(arr: number[]): { min: number; max: number } {
  const finite = arr.filter(Number.isFinite) as number[];
  if (finite.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return min === max ? { min, max: min + 1 } : { min, max };
}

function norm(v: number, min: number, max: number): number {
  return (v - min) / (max - min);
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }

// ---------- Options ----------

export type PlanOptions =
  | number
  | {
      mealsPerDay: number;           // 1..4
      weightCost: number;            // 0..1
      weightTime: number;            // 0..1, typically 1-weightCost
      diversityWeight?: number;      // 0..1
      budgetCapUSD?: number | null;  // optional weekly soft cap
      days?: number;                 // default 7
      maxRepeatsPerWeek?: number;    // default 3 (a bit higher to ensure fill)
      noAdjacentSameTitle?: boolean; // default true
    };

function normalizeOpts(opts: PlanOptions) {
  if (typeof opts === 'number') {
    const w = clamp01(opts);
    return {
      mealsPerDay: 2,
      weightCost: w,
      weightTime: 1 - w,
      diversityWeight: 0.35,
      budgetCapUSD: null,
      days: 7,
      maxRepeatsPerWeek: 3,
      noAdjacentSameTitle: true,
    };
  }
  return {
    mealsPerDay: Math.max(1, Math.min(4, Math.floor(opts.mealsPerDay))),
    weightCost: clamp01(opts.weightCost),
    weightTime: clamp01(opts.weightTime),
    diversityWeight: clamp01(opts.diversityWeight ?? 0.35),
    budgetCapUSD: opts.budgetCapUSD ?? null,
    days: Math.max(1, Math.min(14, Math.floor(opts.days ?? 7))),
    maxRepeatsPerWeek: Math.max(1, Math.min(7, Math.floor(opts.maxRepeatsPerWeek ?? 3))),
    noAdjacentSameTitle: opts.noAdjacentSameTitle ?? true,
  };
}

function slotsForMealsPerDay(mealsPerDay: number): MealSlot[] {
  if (mealsPerDay <= 1) return ['dinner'];
  if (mealsPerDay === 2) return ['lunch', 'dinner'];
  if (mealsPerDay === 3) return ['breakfast', 'lunch', 'dinner'];
  return ['breakfast', 'lunch', 'dinner', 'snack'];
}

function titleKey(s: string) { return s.trim().toLowerCase(); }

// Fixed adjacent-day title check (do NOT rely on array index math)
function appearsOnDay(chosen: DaySlot[], dayIndex: number, title: string): boolean {
  const k = titleKey(title);
  return chosen.some(s => s.dayIndex === dayIndex && titleKey(s.recipe.title) === k);
}

function lastDayIndex(chosen: DaySlot[]): number {
  if (chosen.length === 0) return -1;
  return chosen[chosen.length - 1].dayIndex;
}

// ---------- Core planner ----------

export function planWeek(
  candidates: Candidate[],
  options: PlanOptions
): Plan {
  const opts = normalizeOpts(options);
  const {
    mealsPerDay, weightCost, weightTime, diversityWeight,
    budgetCapUSD, days, maxRepeatsPerWeek, noAdjacentSameTitle
  } = opts;

  const pool = candidates.filter(c => Number.isFinite(c.costUSD) && Number.isFinite(c.minutes));
  if (pool.length === 0) return emptyPlan(days, mealsPerDay);

  const costRange = range(pool.map(c => c.costUSD));
  const timeRange = range(pool.map(c => c.minutes));

  const chosen: DaySlot[] = [];
  const usedTitles = new Map<string, number>();   // title -> count this week
  const usedFamilies = new Map<string, number>(); // diversity tracker
  let runningCost = 0;

  const daySlots = slotsForMealsPerDay(mealsPerDay);

  for (let d = 0; d < days; d++) {
    for (const slot of daySlots) {
      const pick = pickForSlot(d, slot);
      if (pick) applyPick(pick, d, slot);
    }
  }

  const summary = {
    days,
    slotsPerDay: daySlots.length,
    totalCostUSD: chosen.reduce((s, x) => s + x.recipe.costUSD, 0),
    avgMinutes: avg(chosen.map(x => x.recipe.minutes)),
    avgCoverage: avg(pool.map(c => c.coverage ?? 0)),
    avgPriceConfidence: avg(pool.map(c => c.priceConfidence ?? 0)),
    costIsEstimate: avg(pool.map(c => c.coverage ?? 0)) < 0.7,
  };

  return { slots: chosen, summary };

  // ---- helpers bound to this planning run ----

  function pickForSlot(dayIndex: number, slot: MealSlot): Candidate | null {
    // Progressive relaxation phases:
    // A. unique-only, exact slot
    // B. repeats allowed (<= cap), exact slot, block adjacent-day sameTitle
    // C. repeats allowed, exact slot, allow adjacent-day if necessary
    // D. broaden slot compatibility (neighboring slots), repeats ok, block adjacent if possible
    // E. broaden + allow adjacent if still empty
    const phases: Array<(c: Candidate) => boolean> = [
      // A
      (c) => usedCount(c) === 0 && isSlotCompatibleWithFallback(c, slot, 0),
      // B
      (c) => usedCount(c) < maxRepeatsPerWeek &&
             isSlotCompatibleWithFallback(c, slot, 0) &&
             (!noAdjacentSameTitle || !appearsOnDay(chosen, dayIndex - 1, c.title)),
      // C
      (c) => usedCount(c) < maxRepeatsPerWeek &&
             isSlotCompatibleWithFallback(c, slot, 0),
      // D
      (c) => usedCount(c) < maxRepeatsPerWeek &&
             isSlotCompatibleWithFallback(c, slot, 1) &&
             (!noAdjacentSameTitle || !appearsOnDay(chosen, dayIndex - 1, c.title)),
      // E
      (c) => usedCount(c) < maxRepeatsPerWeek &&
             isSlotCompatibleWithFallback(c, slot, 1),
    ];

    for (const pass of phases) {
      const list = pool.filter(pass);
      if (list.length > 0) {
        const candidate = pickBest(list, runningCost, costRange, timeRange, diversityWeight, weightCost, weightTime, budgetCapUSD, usedFamilies);
        if (candidate) return candidate;
      }
    }
    return null;
  }

  function usedCount(c: Candidate) {
    return usedTitles.get(titleKey(c.title)) ?? 0;
  }

  function applyPick(best: Candidate, dayIndex: number, slot: MealSlot) {
    const k = titleKey(best.title);
    usedTitles.set(k, (usedTitles.get(k) || 0) + 1);
    const fam = getKeySet(best).family;
    usedFamilies.set(fam, (usedFamilies.get(fam) || 0) + 1);
    runningCost += best.costUSD;

    const pr: PlanRecipe = {
      id: best.id,
      title: best.title,
      minutes: best.minutes,
      costUSD: best.costUSD,
      ingredients: best.ingredients,
      steps: best.steps,
    };
    chosen.push({ dayIndex, slot, recipe: pr });
  }
}

function pickBest(
  list: Candidate[],
  currentCost: number,
  costRange: { min: number; max: number },
  timeRange: { min: number; max: number },
  diversityWeight: number,
  weightCost: number,
  weightTime: number,
  budgetCapUSD: number | null,
  usedFamilies: Map<string, number>
): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = Infinity;

  for (const c of list) {
    const costN = norm(c.costUSD, costRange.min, costRange.max);
    const timeN = norm(c.minutes, timeRange.min, timeRange.max);

    let score = weightCost * costN + weightTime * timeN;
    score += diversityPenalty(c, usedFamilies, diversityWeight);

    if (budgetCapUSD != null && currentCost > budgetCapUSD) {
      score += (costN * 1.25);
    }

    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function emptyPlan(days: number, mealsPerDay: number): Plan {
  return {
    slots: [],
    summary: {
      days,
      slotsPerDay: mealsPerDay,
      totalCostUSD: 0,
      avgMinutes: 0,
      avgCoverage: 0,
      avgPriceConfidence: 0,
      costIsEstimate: true,
    },
  };
}

// ------------- Utilities for UI -------------

/** Convert flat chosen slots into an array per day, preserving slot order. */
export function toMatrix(plan: Plan): { slot: MealSlot; recipe: PlanRecipe }[][] {
  const byDay: { slot: MealSlot; recipe: PlanRecipe }[][] = [];
  for (const s of plan.slots) {
    if (!byDay[s.dayIndex]) byDay[s.dayIndex] = [];
    byDay[s.dayIndex].push({ slot: s.slot, recipe: s.recipe });
  }
  const order: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'];
  byDay.forEach(day => day.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot)));
  return byDay;
}


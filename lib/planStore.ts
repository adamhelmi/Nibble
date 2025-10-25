// lib/planStore.ts
// Shared, AsyncStorage-backed store for the weekly plan.
// Deterministic actions; UI reads via hook. Chef Chat will call the same actions.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { getPrefs, type Prefs } from './prefs';
import { pickWeek, rescoreWeek, type PlanRecipe, type PlanConstraints, type ScoreWeights, type WeekResult, type TimeWindow } from './scorePlan';

const STORAGE_KEY = 'nibble-plan-v1';

// -------- Types --------

export type PlanMeta = {
  tradeoffWeight: number;       // 0 = fastest, 1 = cheapest
  budgetCapUSD?: number | null; // optional weekly cap
  zip?: string | null;
  updatedAt: number;            // epoch ms
  dayWindows?: Record<number, TimeWindow>;
};

export type PlanState = {
  candidates: PlanRecipe[];     // source pool used to build week
  week: PlanRecipe[];           // selected 7 recipes
  meta: PlanMeta;
};

const DEFAULT_META: PlanMeta = {
  tradeoffWeight: 0.5,
  budgetCapUSD: null,
  zip: null,
  updatedAt: 0,
  dayWindows: {},
};

let state: PlanState = {
  candidates: [],
  week: [],
  meta: { ...DEFAULT_META },
};

const subs = new Set<() => void>();
function emit() { subs.forEach(fn => fn()); }

// -------- Persistence --------

async function save() {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}
export async function loadPlan(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      state = {
        candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
        week: Array.isArray(parsed.week) ? parsed.week : [],
        meta: { ...DEFAULT_META, ...(parsed.meta ?? {}) },
      };
    }
  } catch {}
}

// -------- Validation (guardrails) --------

function forbiddenTermsFromPrefs(p: Prefs): string[] {
  const forbid = new Set<string>();

  // Allergens/dislikes direct tokens
  for (const a of (p.allergens ?? [])) forbid.add(a.toLowerCase());
  for (const d of (p.dislikes ?? [])) forbid.add(d.toLowerCase());

  // Religious basics
  if (p.religious === 'halal') {
    ['pork','bacon','ham','prosciutto','pepperoni','alcohol','wine','beer','rum','gin'].forEach(t => forbid.add(t));
  }
  if (p.religious === 'kosher') {
    ['pork','bacon','ham','shellfish','shrimp','lobster','crab'].forEach(t => forbid.add(t));
  }

  // Diet shortcuts
  if (p.diet === 'vegan') {
    ['meat','chicken','beef','pork','fish','egg','eggs','cheese','milk','butter','honey','yogurt'].forEach(t => forbid.add(t));
  }
  if (p.diet === 'vegetarian') {
    ['meat','chicken','beef','pork','fish','shellfish','shrimp','lobster','crab'].forEach(t => forbid.add(t));
  }
  if (p.diet === 'pescatarian') {
    ['meat','chicken','beef','pork'].forEach(t => forbid.add(t));
  }

  return Array.from(forbid);
}

function buildConstraints(p: Prefs, meta: PlanMeta, pantryItems: string[] = []): PlanConstraints {
  return {
    budgetCapUSD: meta.budgetCapUSD ?? null,
    dayWindows: meta.dayWindows ?? {},
    pantryItems,
    forbidTerms: forbiddenTermsFromPrefs(p),
  };
}

function weightsFromMeta(meta: PlanMeta): ScoreWeights {
  const wc = Math.max(0, Math.min(1, meta.tradeoffWeight ?? 0.5));
  return {
    weightCost: wc,
    weightTime: 1 - wc,
    reuseBonus: 0.12,          // tune later
    varietyPenalty: 0.18,      // tune later
    overBudgetPenalty: 0.6,    // $1 over → 0.6 penalty
    windowPenalty: 0.4,        // time-window mismatch penalty
  };
}

// -------- Public API (actions) --------

export function getPlanState(): PlanState { return state; }

export async function setCandidates(pool: PlanRecipe[]): Promise<void> {
  state.candidates = pool ?? [];
  await save(); emit();
}

export async function setTradeoffWeight(w: number): Promise<void> {
  state.meta.tradeoffWeight = Math.max(0, Math.min(1, w));
  state.meta.updatedAt = Date.now();
  await save(); emit();
}

export async function setBudgetCapUSD(cap: number | null): Promise<void> {
  state.meta.budgetCapUSD = (cap == null || isNaN(cap)) ? null : Math.max(0, cap);
  state.meta.updatedAt = Date.now();
  await save(); emit();
}

export async function setDayWindow(index: number, w: TimeWindow): Promise<void> {
  state.meta.dayWindows = { ...(state.meta.dayWindows ?? {}), [index]: w };
  state.meta.updatedAt = Date.now();
  await save(); emit();
}

export async function generateWeek(pantryItems: string[] = []): Promise<WeekResult> {
  const prefs = getPrefs();
  const constraints = buildConstraints(prefs, state.meta, pantryItems);
  const weights = weightsFromMeta(state.meta);

  const result = pickWeek(state.candidates, weights, constraints);
  state.week = result.days.map(d => d.recipe);
  state.meta.updatedAt = Date.now();

  await save(); emit();
  return result;
}

export async function rescoreCurrentWeek(pantryItems: string[] = []): Promise<WeekResult> {
  if (state.week.length !== 7) {
    // If we don't have a full week yet, just (re)generate from pool
    return generateWeek(pantryItems);
  }
  const prefs = getPrefs();
  const constraints = buildConstraints(prefs, state.meta, pantryItems);
  const weights = weightsFromMeta(state.meta);

  const result = rescoreWeek(state.week, weights, constraints);
  state.meta.updatedAt = Date.now();

  await save(); emit();
  return result;
}

export async function replaceDay(index: number, recipe: PlanRecipe): Promise<void> {
  if (index < 0 || index > 6) return;
  state.week[index] = recipe;
  state.meta.updatedAt = Date.now();
  await save(); emit();
}

export async function swapDays(a: number, b: number): Promise<void> {
  if (a < 0 || a > 6 || b < 0 || b > 6) return;
  const tmp = state.week[a];
  state.week[a] = state.week[b];
  state.week[b] = tmp;
  state.meta.updatedAt = Date.now();
  await save(); emit();
}

// -------- Hook --------

export function usePlan(): PlanState {
  const subscribe = (cb: () => void) => { subs.add(cb); return () => subs.delete(cb); };
  const getSnapshot = () => state;
  // SSR fallback same as client since this is client-only
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

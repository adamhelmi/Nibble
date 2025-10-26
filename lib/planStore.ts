// lib/planStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { nanoid } from 'nanoid/non-secure';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'dessert';

export type Meal = {
  id: string;
  name: string;
  slot: MealSlot;
  recipeId?: string;
  ingredients: { name: string; qty?: string; unit?: string }[];
  tags: string[];
  timeMins: number;
  costUSD: number;
  nutrition?: { kcal?: number; protein?: number; carbs?: number; fat?: number };
  source: 'deterministic' | 'ai';
  locked?: boolean;
};

export type DayPlan = {
  dateISO: string;
  slots: Record<MealSlot, Meal | null>;
};

export type DiversityReport = {
  protein: Record<string, number>;
  cuisine: Record<string, number>;
  repeats: { reason: 'protein' | 'cuisine'; day: number; slot: MealSlot; offending: string }[];
};

export type WeekPlan = {
  weekId: string;           // YYYY-WW
  days: DayPlan[];
  budgetUSD?: number;
  timeVsMoney: number;      // 0..100
  updatedAt: string;
  version: number;
};

export type PlanChange = { ts: string; summary: string; commands: PlanCommand[]; actor: 'user'|'assistant' };

export type PlanCommand =
 | { op: 'swap', a: { day: number; slot: MealSlot }, b: { day: number; slot: MealSlot } }
 | { op: 'replace', day: number; slot: MealSlot, meal: Meal } // fully specified Meal from deterministic/AI proposer
 | { op: 'lock', day: number; slot: MealSlot, locked: boolean }
 | { op: 'optimize', target: 'cost' | 'time', delta: number }   // +/- dollars or minutes
 | { op: 'fill-gaps' };

type State = {
  week: WeekPlan | null;
  changes: PlanChange[];
  getWeek: () => WeekPlan | null;
  setWeek: (w: WeekPlan) => void;
  patch: (fn: (w: WeekPlan) => WeekPlan) => void;
  swap: (dayA: number, slotA: MealSlot, dayB: number, slotB: MealSlot) => void;
  replace: (day: number, slot: MealSlot, meal: Meal) => void;
  lock: (day: number, slot: MealSlot, locked: boolean) => void;
  optimize: (target: 'cost'|'time', delta: number) => void;
  fillGaps: () => void;
  stats: () => { totalCost: number; avgTime: number; diversity: DiversityReport; lockedCount: number };
  persist: () => Promise<void>;
  load: (weekId?: string) => Promise<void>;
  applyCommands: (cmds: PlanCommand[], actor: 'user'|'assistant') => void;
};

const STORAGE_KEY_LATEST = 'nibble.week.latest';

function isoWeekId(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Monday=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(),0,4));
  const week = 1 + Math.round(((+date - +firstThursday)/86400000 - 3 + ((firstThursday.getUTCDay()+6)%7))/7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}

function emptyDay(dateISO: string): DayPlan {
  const slots: Record<MealSlot, Meal | null> = {
    breakfast: null, lunch: null, dinner: null, snack: null, dessert: null
  };
  return { dateISO, slots };
}

function defaultWeek(): WeekPlan {
  const start = new Date();
  const days: DayPlan[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return emptyDay(d.toISOString().slice(0,10));
  });
  return {
    weekId: isoWeekId(start),
    days,
    budgetUSD: 70,
    timeVsMoney: 50,
    updatedAt: new Date().toISOString(),
    version: 1,
  };
}

async function saveWeek(w: WeekPlan) {
  await AsyncStorage.setItem(`nibble.week.${w.weekId}`, JSON.stringify(w));
  await AsyncStorage.setItem(STORAGE_KEY_LATEST, w.weekId);
}

async function loadWeek(weekId?: string): Promise<WeekPlan> {
  let id = weekId;
  if (!id) id = await AsyncStorage.getItem(STORAGE_KEY_LATEST) ?? undefined;
  if (id) {
    const raw = await AsyncStorage.getItem(`nibble.week.${id}`);
    if (raw) return JSON.parse(raw);
  }
  const w = defaultWeek();
  await saveWeek(w);
  return w;
}

function diversityReport(week: WeekPlan): DiversityReport {
  const protein: Record<string, number> = {};
  const cuisine: Record<string, number> = {};
  const repeats: DiversityReport['repeats'] = [];
  week.days.forEach((d, di) => {
    (Object.keys(d.slots) as MealSlot[]).forEach(slot => {
      const m = d.slots[slot];
      if (!m) return;
      const p = (m.tags.find(t => t.startsWith('protein:')) ?? 'protein:unknown').split(':')[1];
      const c = (m.tags.find(t => t.startsWith('cuisine:')) ?? 'cuisine:unknown').split(':')[1];
      protein[p] = (protein[p] ?? 0) + 1;
      cuisine[c] = (cuisine[c] ?? 0) + 1;
      if (protein[p] > 2) repeats.push({ reason: 'protein', day: di, slot, offending: p });
      if (cuisine[c] > 2) repeats.push({ reason: 'cuisine', day: di, slot, offending: c });
    });
  });
  return { protein, cuisine, repeats };
}

export const usePlanStore = create<State>((set, get) => ({
  week: null,
  changes: [],
  getWeek: () => get().week,
  setWeek: (w) => { set({ week: w }); get().persist(); },
  patch: (fn) => {
    const w = get().week ?? defaultWeek();
    const next = fn({ ...w, updatedAt: new Date().toISOString() });
    set({ week: next });
    get().persist();
  },
  swap: (dayA, slotA, dayB, slotB) => {
    get().patch(w => {
      const a = w.days[dayA].slots[slotA];
      const b = w.days[dayB].slots[slotB];
      if (a?.locked || b?.locked) return w;
      const ww = structuredClone(w);
      ww.days[dayA].slots[slotA] = b;
      ww.days[dayB].slots[slotB] = a;
      return ww;
    });
  },
  replace: (day, slot, meal) => {
    get().patch(w => {
      const current = w.days[day].slots[slot];
      if (current?.locked) return w;
      const ww = structuredClone(w);
      ww.days[day].slots[slot] = { ...meal, id: meal.id || nanoid(), slot };
      return ww;
    });
  },
  lock: (day, slot, locked) => {
    get().patch(w => {
      const ww = structuredClone(w);
      const m = ww.days[day].slots[slot];
      if (m) m.locked = locked;
      return ww;
    });
  },
  optimize: (target, delta) => {
    // Deterministic placeholder: apply proportional tweaks to unlocked meals.
    get().patch(w => {
      const ww = structuredClone(w);
      const flat: Meal[] = [];
      ww.days.forEach(d => (Object.values(d.slots).forEach(m => m && !m.locked && flat.push(m))));
      if (flat.length === 0) return ww;
      if (target === 'cost') {
        const per = delta / flat.length;
        flat.forEach(m => m.costUSD = Math.max(0, m.costUSD + per));
      } else {
        const per = Math.round(delta / flat.length);
        flat.forEach(m => m.timeMins = Math.max(1, m.timeMins + per));
      }
      return ww;
    });
  },
  fillGaps: () => {
    get().patch(w => {
      const ww = structuredClone(w);
      ww.days.forEach(d => {
        (Object.keys(d.slots) as MealSlot[]).forEach(slot => {
          if (!d.slots[slot]) {
            d.slots[slot] = {
              id: nanoid(),
              name: slot === 'breakfast' ? 'Oatmeal & Fruit' : 'Pasta Pomodoro',
              slot,
              ingredients: [],
              tags: ['protein:veg', 'cuisine:generic'],
              timeMins: slot === 'breakfast' ? 6 : 18,
              costUSD: slot === 'breakfast' ? 1.2 : 3.8,
              source: 'deterministic',
            };
          }
        });
      });
      return ww;
    });
  },
  stats: () => {
    const w = get().week ?? defaultWeek();
    let totalCost = 0, totalTime = 0, count = 0, lockedCount = 0;
    w.days.forEach(d => (Object.values(d.slots).forEach(m => {
      if (!m) return;
      totalCost += m.costUSD;
      totalTime += m.timeMins;
      count += 1;
      if (m.locked) lockedCount += 1;
    })));
    const diversity = diversityReport(w);
    return { totalCost, avgTime: count ? totalTime / count : 0, diversity, lockedCount };
  },
  persist: async () => {
    const w = get().week;
    if (w) await saveWeek(w);
  },
  load: async (weekId?: string) => {
    const w = await loadWeek(weekId);
    set({ week: w });
  },
  applyCommands: (cmds, actor) => {
    const start = Date.now();
    cmds.forEach(c => {
      if (c.op === 'swap') get().swap(c.a.day, c.a.slot, c.b.day, c.b.slot);
      else if (c.op === 'replace') get().replace(c.day, c.slot, c.meal);
      else if (c.op === 'lock') get().lock(c.day, c.slot, c.locked);
      else if (c.op === 'optimize') get().optimize(c.target, c.delta);
      else if (c.op === 'fill-gaps') get().fillGaps();
    });
    const summary = cmds.map(c => c.op).join(', ');
    set(s => ({ changes: [...s.changes, { ts: new Date().toISOString(), summary, commands: cmds, actor }] }));
    console.log('[plan.apply]', { ms: Date.now() - start, summary });
  },
}));

// Helper for AI system prompts — compact snapshot of the week
export function planCapsule(): string {
  const w = usePlanStore.getState().getWeek();
  if (!w) return 'WEEK: <none>';
  const locks: string[] = [];
  w.days.forEach((d, di) => (Object.entries(d.slots).forEach(([slot, m]) => {
    if (m?.locked) locks.push(`(${di}:${slot})`);
  })));
  const { totalCost, avgTime, diversity } = usePlanStore.getState().stats();
  const gaps: string[] = [];
  w.days.forEach((d, di) => (Object.entries(d.slots).forEach(([slot, m]) => { if (!m) gaps.push(`${di}:${slot}`); })));
  return [
    `WEEK ${w.weekId}`,
    `BUDGET $${w.budgetUSD ?? 'n/a'} | SLIDER ${w.timeVsMoney}/100`,
    `COST ~$${totalCost.toFixed(2)} | AVG TIME ${avgTime.toFixed(1)}m`,
    `LOCKS [${locks.join(', ')}]`,
    `DIVERSITY protein=${JSON.stringify(diversity.protein)} cuisine=${JSON.stringify(diversity.cuisine)}`,
    `GAPS [${gaps.join(', ')}]`,
  ].join('\n');
}

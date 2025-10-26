// app/planner.tsx
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { T, C } from '../lib/ui';
import usePantry, { PantryState } from '../store/usePantry';
import { aiSuggestRecipes, OLLAMA_URL, type AIRecipe } from '../lib/ai';
import { useToast } from '../hooks/useToast';
import TradeoffSlider from '../components/TradeoffSlider';
import { planWeek, toMatrix, type Candidate, type MealSlot } from '../lib/mealPlanner';
import { usePing } from '../hooks/usePing';
import { buildPriceBookWithStats, type PriceBook, normalize as normName } from '../lib/livePricing';
import type { Unit as PriceUnit } from '../lib/livePricing';

import { ensurePrefsLoaded, getPrefs } from '../lib/prefs';
import { getMockCandidates } from '../lib/mockData';

// Day 5: shared plan store
import { usePlanStore, type WeekPlan, type Meal as PlanMeal, type MealSlot as StoreSlot } from '../lib/planStore';

// ---------- local helpers from Recipes (parsers) ----------
function parseFraction(s: string) {
  const parts = s.trim().split(' '); let t = 0;
  for (const p of parts) {
    if (p.includes('/')) { const [a,b]=p.split('/'); const n=+a,d=+b; if (isFinite(n)&&isFinite(d)&&d!==0) t+=n/d; }
    else { const n=+p; if (isFinite(n)) t+=n; }
  } return t||0;
}
const UNIT_MAP: Record<string, PriceUnit> = {
  g:'g', gram:'g', grams:'g',
  kg:'kg', kilogram:'kg', kilograms:'kg',
  ml:'ml', milliliter:'ml', milliliters:'ml',
  l:'l', liter:'l', liters:'l',
  tbsp:'tbsp', tablespoon:'tbsp', tablespoons:'tbsp',
  tsp:'tsp', teaspoon:'tsp', teaspoons:'tsp',
  cup:'cup', cups:'cup',
  unit:'unit', piece:'unit', pieces:'unit', pc:'unit', pcs:'unit', whole:'unit',
  egg:'unit', eggs:'unit', clove:'unit', cloves:'unit', onion:'unit', onions:'unit',
};
type Parsed = { name: string; qty: number; unit: PriceUnit; raw: string };
function parseIngredient(line: string): Parsed {
  const raw = line.trim();
  const m = raw.match(/^([\d]+(?:\s+\d\/\d)?|\d*\.?\d+)?\s*([a-zA-Z]+)?\s*(.*)$/);
  let qty = 0; let unit: PriceUnit = 'unit'; let name = raw;
  if (m) {
    const qtyStr = m[1]; const unitStr = m[2]; const rest = m[3]?.trim();
    if (qtyStr) qty = parseFraction(qtyStr);
    if (unitStr && UNIT_MAP[unitStr.toLowerCase()]) { unit = UNIT_MAP[unitStr.toLowerCase()]; name = rest || raw; }
    else { const pm = rest?.match(/\(([\d\/\s\.]+)\)/); if (!qty && pm) qty = parseFraction(pm[1]); name = rest || raw; }
  }
  if (!qty) qty = 1;
  name = normName(name.replace(/^[\-\•]+\s*/, '').replace(/\s*\(.*?\)\s*$/, ''));
  return { name, qty, unit, raw };
}
function toPricingQty(qty: number, from: PriceUnit, priceUnit: PriceUnit): number | null {
  if (from === priceUnit) return qty;
  if (from === 'kg' && priceUnit === 'g') return qty * 1000;
  if (from === 'g'  && priceUnit === 'kg') return qty / 1000;
  if (from === 'l'  && priceUnit === 'ml') return qty * 1000;
  if (from === 'ml' && priceUnit === 'l')  return qty / 1000;
  if (from === 'tbsp' && priceUnit === 'ml') return qty * 15;
  if (from === 'tsp'  && priceUnit === 'ml') return qty * 5;
  if (from === 'cup'  && priceUnit === 'ml') return qty * 240;
  if (from === 'unit' && priceUnit === 'unit') return qty;
  return null;
}
function estimateRecipeCostUSD(ingredients: string[], book?: PriceBook): { total: number; coverage: number } {
  if (!book) return { total: 0, coverage: 0 };
  const parsed = ingredients.map(parseIngredient);
  let total = 0; let priced = 0;
  for (const ing of parsed) {
    const key = normName(ing.name);
    const price = (book[key] || book[key.replace(/\b(fresh|chopped|diced|minced|boneless|skinless)\b/g, '').trim().replace(/\s+/g,' ')]);
    if (!price) continue;
    const q = toPricingQty(ing.qty, ing.unit, price.unit);
    if (q == null) continue;
    total += q * price.amount; priced++;
  }
  const coverage = parsed.length ? priced / parsed.length : 0;
  return { total: +total.toFixed(2), coverage };
}

// ---------- tiny UI bits ----------
function Seg({
  options, value, onChange,
}: { options: Array<{ label: string; val: number }>; value: number; onChange: (v: number) => void; }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: '#e2e8f0', borderRadius: 999, padding: 4 }}>
      {options.map(o => {
        const active = o.val === value;
        return (
          <TouchableOpacity key={o.val} onPress={() => onChange(o.val)}
            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: active ? C.action : 'transparent', marginRight: 4 }}>
            <Text style={{ color: active ? '#fff' : '#0f172a', fontWeight: '700' }}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
function Badge({ text, kind = 'muted' }: { text: string; kind?: 'muted'|'warn'|'ok' }) {
  const tone = { muted:{bg:'#e2e8f0',fg:'#0f172a'}, warn:{bg:'#fff7ed',fg:'#9a3412'}, ok:{bg:'#ecfdf5',fg:'#065f46'} } as const;
  const k = tone[kind];
  return <View style={{ backgroundColor: k.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6 }}>
    <Text style={{ color: k.fg, fontWeight: '700', fontSize: 12 }}>{text}</Text>
  </View>;
}
const SLOT_LABEL: Record<MealSlot, string> = { breakfast:'Breakfast', lunch:'Lunch', dinner:'Dinner', snack:'Snack', dessert:'Dessert' };

// ---------- types for unified render from store ----------
type RenderSlot = { slot: MealSlot; recipe: { title: string; minutes: number; costUSD: number; ingredients: string[]; id?: string } };
type RenderPlan = {
  summary: {
    days: number;
    slotsPerDay: number;
    totalCostUSD: number;
    avgMinutes: number;
    avgCoverage: number;
    avgPriceConfidence: number;
    costIsEstimate: boolean;
  };
  matrix: RenderSlot[][];
};

// Build a renderable plan from WeekPlan in the store (so UI survives remounts and reflects Chat edits)
function buildRenderFromStore(week: WeekPlan | null | undefined): RenderPlan | null {
  if (!week) return null;
  const days = week.days ?? [];
  const matrix: RenderSlot[][] = days.map((d) => {
    const slots: RenderSlot[] = [];
    (['breakfast','lunch','dinner','snack','dessert'] as MealSlot[]).forEach((s) => {
      const m = d.slots[s] as PlanMeal | null;
      if (m) {
        slots.push({
          slot: s,
          recipe: {
            id: m.recipeId,
            title: m.name,
            minutes: m.timeMins ?? 15,
            costUSD: m.costUSD ?? 3.5,
            ingredients: (m.ingredients ?? []).map(x => x.name),
          },
        });
      }
    });
    return slots;
  });

  const flat = matrix.flatMap(day => day.map(x => x.recipe));
  const totalCost = flat.reduce((a, r) => a + (r.costUSD || 0), 0);
  const avgMin = flat.length ? flat.reduce((a, r) => a + (r.minutes || 0), 0) / flat.length : 0;
  // We don’t yet store per-ingredient coverage in the store; present conservative estimates:
  const avgCoverage = 0.65;
  const avgPriceConfidence = 0.6;

  return {
    summary: {
      days: days.length || 7,
      slotsPerDay: days.length ? Math.round((flat.length / days.length) * 100) / 100 : 0,
      totalCostUSD: +totalCost.toFixed(2),
      avgMinutes: avgMin,
      avgCoverage,
      avgPriceConfidence,
      costIsEstimate: true,
    },
    matrix,
  };
}

// ---------- Screen ----------
export default function PlannerScreen() {
  const router = useRouter();
  const items = usePantry((s: PantryState) => s.items);
  const { show, ToastElement } = useToast();
  const { ok } = usePing();

  const [zip] = useState<string>((Constants?.expoConfig?.extra as any)?.EXPO_PUBLIC_DEFAULT_ZIP ?? '45202');
  const [book, setBook] = useState<PriceBook | undefined>(undefined);

  const [weightCost, setWeightCost] = useState(0.5);
  const [mealsPerDay, setMealsPerDay] = useState(2);
  const [diversityWeight, setDiversityWeight] = useState(0.35);
  const [budgetCap, setBudgetCap] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [aiPool, setAiPool] = useState<AIRecipe[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [renderPlan, setRenderPlan] = useState<RenderPlan | null>(null);

  // plan store hooks
  const planStore = usePlanStore();
  const { load, setWeek, getWeek, changes } = planStore;

  // Load persisted week on mount and render it
  useEffect(() => {
    (async () => {
      try { await load(); } catch {}
      const w = getWeek();
      const rp = buildRenderFromStore(w);
      if (rp) setRenderPlan(rp);
    })();
    // subscribe to store changes to live-update UI (e.g., Chef Chat edits)
    const unsub = usePlanStore.subscribe((state) => {
  const rp = buildRenderFromStore(state.week);
  setRenderPlan(rp);
});

    return () => unsub();
  }, [load, getWeek]);

  const canGenerate = useMemo(() => items.length > 0, [items]);

  async function ensurePriceBook(terms: string[]) {
    if (terms.length === 0) return;
    if (book) return;
    const stats = await buildPriceBookWithStats(terms.slice(0, 120), zip);
    setBook(stats.book);
    show(`Pricing indexed: ${stats.priced}/${stats.inspected} (${stats.missing} missing)`);
  }

  function mapAItoCandidates(recs: AIRecipe[]): Candidate[] {
    return recs.map((r, i) => {
      const est = estimateRecipeCostUSD(r.ingredients, book);
      return {
        id: `${r.title}-ai-${i}`,
        title: r.title,
        minutes: Math.max(5, Math.min(180, r.minutes || 20)),
        costUSD: est.total,
        ingredients: r.ingredients.map(x => normName(x.replace(/\(.*?\)/g, '').trim())),
        steps: r.steps,
        tags: [],
        coverage: est.coverage,
        priceConfidence: est.coverage,
      };
    });
  }

  // Convert planner output → planStore WeekPlan (so it persists and is chat-editable)
  function syncToPlanStore(out: ReturnType<typeof planWeek>) {
    const start = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return { dateISO: d.toISOString().slice(0, 10), slots: { breakfast: null, lunch: null, dinner: null, snack: null, dessert: null } as Record<StoreSlot, PlanMeal | null> };
    });

    const matrix = toMatrix(out);
    matrix.forEach((daySlots, di) => {
      daySlots.forEach((s) => {
        const slot = s.slot as StoreSlot;
        const pm: PlanMeal = {
          id: `${di}-${slot}-${s.recipe.title}`.toLowerCase().replace(/\s+/g, '-'),
          name: s.recipe.title,
          slot,
          recipeId: s.recipe.id ?? undefined,
          ingredients: (s.recipe.ingredients || []).map(n => ({ name: n })),
          tags: [],
          timeMins: s.recipe.minutes || 15,
          costUSD: s.recipe.costUSD || 3.5,
          nutrition: undefined,
          source: 'deterministic',
          locked: false,
        };
        days[di].slots[slot] = pm;
      });
    });

    const weekId = (() => {
      const date = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
      const dayNum = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - dayNum + 3);
      const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
      const week = 1 + Math.round(((+date - +firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
      return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    })();

    const week: WeekPlan = {
      weekId,
      days,
      budgetUSD: isFinite(parseFloat(budgetCap)) ? parseFloat(budgetCap) : undefined,
      timeVsMoney: Math.round(weightCost * 100),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    setWeek(week);
  }

  async function generatePlan() {
    if (!canGenerate) { show('Add some pantry items or use Scan first.'); return; }
    setLoading(true);
    try {
      await ensurePrefsLoaded();
      const prefs = getPrefs();

      // 1) AI pool (honors prefs via system prompt)
      const ai = await aiSuggestRecipes(items);
      const recs = ai.recipes || [];
      setAiPool(recs);

      // 2) Pricebook off AI terms (best effort)
      const aiTerms = Array.from(new Set(recs.flatMap(r => r.ingredients).map(s => normName(s))));
      await ensurePriceBook(aiTerms);

      // 3) AI → candidates
      let cands: Candidate[] = mapAItoCandidates(recs);

      // 4) Top up with mock pool for diversity
      if (cands.length < 12) {
        const mock = getMockCandidates(items, prefs, 40);
        const seen = new Set(cands.map(c => c.title.toLowerCase()));
        const extra = mock.filter(m => !seen.has(m.title.toLowerCase()));
        cands = [...cands, ...extra].slice(0, 40);
      }
      setCandidates(cands);

      // 5) Plan week via deterministic engine
      const numericBudget = parseFloat(budgetCap);
      const out = planWeek(cands, {
        mealsPerDay,
        weightCost,
        weightTime: 1 - weightCost,
        diversityWeight,
        budgetCapUSD: isFinite(numericBudget) ? numericBudget : null,
      });

      // 6) Persist into shared store (source of truth)
      syncToPlanStore(out);

      // 7) Build render plan from store so UI survives remounts + reflects Chat edits
      const rp = buildRenderFromStore(usePlanStore.getState().week);
      setRenderPlan(rp);

      show('Plan generated and synced.');
    } catch (e: any) {
      setRenderPlan(null);
      show(`Planner error: ${e?.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* Header */}
      <View style={{ position: 'relative', paddingRight: 100 }}>
        <Text style={T.h1}>Weekly Planner</Text>
        <Text style={[T.muted, { marginTop: 4 }]}>
          Local AI: {ok ? 'online' : 'offline'} · AI URL: {OLLAMA_URL || '(missing)'}
        </Text>
        {/* Chef Chat button (top-right) */}
        <TouchableOpacity
          onPress={() => router.push('/chef-chat')}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            backgroundColor: C.action,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 999,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Chef Chat</Text>
        </TouchableOpacity>
      </View>

      {/* Controls */}
      <View style={{ marginTop: 12, padding: 12, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: '#f8fafc' }}>
        <Text style={T.h2}>Time ↔ Money</Text>
        <TradeoffSlider value={weightCost} onChange={setWeightCost} />
        <Text style={{ color: '#475569', marginTop: 6 }}>
          We pick meals by minimizing a weighted blend of time and cost, then enforce variety.
        </Text>

        <View style={{ marginTop: 12, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontWeight: '800' }}>Meals per day</Text>
            <Seg
              options={[{label:'1',val:1},{label:'2',val:2},{label:'3',val:3},{label:'4',val:4}]}
              value={mealsPerDay}
              onChange={setMealsPerDay}
            />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontWeight: '800' }}>Variety</Text>
            <Seg
              options={[{label:'Chill',val:0.2},{label:'Balanced',val:0.35},{label:'High',val:0.55}]}
              value={diversityWeight}
              onChange={setDiversityWeight}
            />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontWeight: '800' }}>Weekly budget</Text>
            <TextInput
              value={budgetCap}
              onChangeText={setBudgetCap}
              keyboardType="decimal-pad"
              placeholder="$ e.g. 75"
              placeholderTextColor="#64748b"
              style={{ flex: 0.6, backgroundColor: '#e2e8f0', color: '#0f172a', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}
            />
          </View>

          <TouchableOpacity
            onPress={generatePlan}
            disabled={loading}
            style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: loading ? C.actionDisabled : C.action, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>{loading ? 'Planning…' : 'Generate plan'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Summary */}
      {renderPlan && (
        <View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: '#ffffff', borderColor: C.border, borderWidth: 1 }}>
          <Text style={T.h2}>Summary</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <Badge text={`Days: ${renderPlan.summary.days}`} />
            <Badge text={`Meals/day: ${renderPlan.summary.slotsPerDay}`} />
            <Badge text={`Total: $${renderPlan.summary.totalCostUSD.toFixed(2)}`} kind={renderPlan.summary.costIsEstimate ? 'warn' : 'ok'} />
            <Badge text={`Avg time: ${renderPlan.summary.avgMinutes.toFixed(0)} min`} />
            <Badge text={`Coverage: ${(renderPlan.summary.avgCoverage * 100).toFixed(0)}%`} kind={renderPlan.summary.avgCoverage >= 0.7 ? 'ok' : 'warn'} />
            <Badge text={`Price conf.: ${(renderPlan.summary.avgPriceConfidence * 100).toFixed(0)}%`} />
          </View>
          {renderPlan.summary.costIsEstimate && (
            <Text style={{ color: '#9a3412', marginTop: 6 }}>
              Cost marked as estimate due to limited price coverage. Live retailer adapters will harden this.
            </Text>
          )}
        </View>
      )}

      {/* Plan grid (from shared store) */}
      {renderPlan && (
        <View style={{ marginTop: 16 }}>
          <Text style={T.h2}>Your week</Text>
          {renderPlan.matrix.map((daySlots, dayIdx) => (
            <View key={dayIdx} style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: '#ffffff', borderColor: C.border, borderWidth: 1 }}>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>Day {dayIdx + 1}</Text>
              {daySlots.map((slot, i) => (
                <View key={i} style={{ marginTop: 8 }}>
                  <Text style={{ fontWeight: '700', color: '#0f172a' }}>
                    {({ breakfast:'Breakfast', lunch:'Lunch', dinner:'Dinner', snack:'Snack', dessert:'Dessert' } as Record<MealSlot,string>)[slot.slot]}
                  </Text>
                  <Text style={{ color: '#111827', marginTop: 2 }}>{slot.recipe.title}</Text>
                  <Text style={{ color: '#475569' }}>~{slot.recipe.minutes} min · ~${slot.recipe.costUSD.toFixed(2)}</Text>
                  <Text style={{ color: '#64748b', marginTop: 2 }}>
                    Needs: {slot.recipe.ingredients.slice(0, 8).map(s => s.replace(/\(.*?\)/g, '').trim()).join(', ')}
                    {slot.recipe.ingredients.length > 8 ? '…' : ''}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      {!renderPlan && (
        <View style={{ marginTop: 16 }}>
          <Text style={T.muted}>No plan yet. Configure the controls above and tap “Generate plan”.</Text>
        </View>
      )}

      {/* Change Log (edits from Chef Chat or UI) */}
      <View style={{ marginTop: 24 }}>
        <Text style={T.h2}>Change Log</Text>
        {changes.length === 0 && <Text style={T.muted}>No edits yet.</Text>}
        {changes.slice().reverse().map((c, idx) => (
          <View key={idx} style={{ marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' }}>
            <Text style={{ fontWeight: '700' }}>{new Date(c.ts).toLocaleString()} · {c.actor}</Text>
            <Text>{c.summary}</Text>
          </View>
        ))}
      </View>

      {/* Debug */}
      <Text style={[T.muted, { marginTop: 16 }]}>Pantry: {items.length ? items.join(', ') : '— empty —'}</Text>
      <Text style={[T.muted, { marginTop: 4 }]}>AI ideas: {aiPool.length || 0} · Candidates: {candidates.length || 0}</Text>

      {ToastElement}
    </ScrollView>
  );
}


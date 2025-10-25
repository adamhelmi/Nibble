// app/recipes.tsx
// PURPOSE: Rule-based + AI recipes with live pricing and cost-per-serving + tap-to-substitute + replace action.

import React, { useMemo, useState, useLayoutEffect } from "react";
import { View, Text, FlatList, TouchableOpacity, ScrollView, TextInput } from "react-native";
import Constants from "expo-constants";
import { aiSuggestRecipes, OLLAMA_URL, type AIRecipe } from "../lib/ai";
import usePantry, { PantryState } from "../store/usePantry";
import { matchRecipes, type Recipe } from "../lib/recipeEngine";
import { useNavigation, useRouter } from 'expo-router';
import { T, SP, C } from "../lib/ui";
import Shimmer from "../components/shimmer";
import EmptyState from "../components/EmptyState";
import { useToast } from "../hooks/useToast";
import { usePing } from "../hooks/usePing";

// Live pricing client (stats variant)
import {
  buildPriceBookWithStats,
  normalize as normName,
  type PriceBook,
  type Unit as PriceUnit,
  CURRENT_PRICING_URL
} from "../lib/livePricing";

// Substitutions engine
import {
  getSubstitutions,
  hasSubstitutions,
} from "../lib/substitutions";

// ⬅️ NEW: global user preferences
import { usePrefs } from "../lib/prefs";

// ---------- Small presentational helpers ----------
function Divider() {
  return <View style={{ height: 1, backgroundColor: "#e5e7eb", marginVertical: 12 }} />;
}
function MetaLine({ text, muted = false }: { text: string; muted?: boolean }) {
  return <Text style={{ marginTop: 4, color: muted ? "#6b7280" : "#374151" }}>{text}</Text>;
}

// ---------- Minimal parsing + cost (local helpers) ----------
type Parsed = { name: string; qty: number; unit: PriceUnit; raw: string };

const UNIT_MAP: Record<string, PriceUnit> = {
  g: "g", gram: "g", grams: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", milliliter: "ml", milliliters: "ml",
  l: "l", liter: "l", liters: "l",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  cup: "cup", cups: "cup",
  unit: "unit", piece: "unit", pieces: "unit", pc: "unit", pcs: "unit", whole: "unit",
  egg: "unit", eggs: "unit", clove: "unit", cloves: "unit", onion: "unit", onions: "unit",
};

function parseFraction(s: string) {
  const parts = s.trim().split(" ");
  let t = 0;
  for (const p of parts) {
    if (p.includes("/")) {
      const [a, b] = p.split("/");
      const n = parseFloat(a), d = parseFloat(b);
      if (isFinite(n) && isFinite(d) && d !== 0) t += n / d;
    } else {
      const n = parseFloat(p);
      if (isFinite(n)) t += n;
    }
  }
  return t || 0;
}

function parseIngredient(line: string): Parsed {
  const raw = line.trim();
  const m = raw.match(/^([\d]+(?:\s+\d\/\d)?|\d*\.?\d+)?\s*([a-zA-Z]+)?\s*(.*)$/);
  let qty = 0;
  let unit: PriceUnit = "unit";
  let name = raw;

  if (m) {
    const qtyStr = m[1];
    const unitStr = m[2];
    const rest = m[3]?.trim();
    if (qtyStr) qty = parseFraction(qtyStr);
    if (unitStr && UNIT_MAP[unitStr.toLowerCase()]) {
      unit = UNIT_MAP[unitStr.toLowerCase()];
      name = rest || raw;
    } else {
      const pm = rest?.match(/\(([\d\/\s\.]+)\)/);
      if (!qty && pm) qty = parseFraction(pm[1]);
      name = rest || raw;
    }
  }
  if (!qty) qty = 1;
  name = normName(name.replace(/^[\-\•]+\s*/, '').replace(/\s*\(.*?\)\s*$/, ''));
  return { name, qty, unit, raw };
}

function toPricingQty(qty: number, from: PriceUnit, priceUnit: PriceUnit): number | null {
  if (from === priceUnit) return qty;
  if (from === "kg" && priceUnit === "g") return qty * 1000;
  if (from === "g"  && priceUnit === "kg") return qty / 1000;
  if (from === "l"  && priceUnit === "ml") return qty * 1000;
  if (from === "ml" && priceUnit === "l")  return qty / 1000;
  if (from === "tbsp" && priceUnit === "ml") return qty * 15;
  if (from === "tsp"  && priceUnit === "ml") return qty * 5;
  if (from === "cup"  && priceUnit === "ml") return qty * 240;
  if (from === "unit" && priceUnit === "unit") return qty;
  return null;
}

function estimateRecipeCostUSD(ingredients: string[], book?: PriceBook): { total: number; missing: string[] } {
  if (!book) return { total: 0, missing: [] };
  const parsed = ingredients.map(parseIngredient);
  let total = 0;
  const missing: string[] = [];

  for (const ing of parsed) {
    const key = normName(ing.name);
    const price = book[key] || book[key.replace(/\b(fresh|chopped|diced|minced|boneless|skinless)\b/g, '').trim().replace(/\s+/g, ' ')];
    if (!price) { missing.push(ing.name); continue; }
    const q = toPricingQty(ing.qty, ing.unit, price.unit);
    if (q == null) { missing.push(ing.name); continue; }
    total += q * price.amount;
  }
  return { total: +total.toFixed(2), missing };
}

// ---------- Rule-based recipe card (now uses live pricing if available) ----------
function RuleRecipeCard({ r, priceBook }: { r: Recipe; priceBook?: PriceBook }) {
  const [open, setOpen] = useState(false);

  // Compute a live cost estimate from the rule recipe ingredients if we have a priceBook;
  // fallback to the legacy static estimatedCost (per serving) if we don't.
  const live = useMemo(() => estimateRecipeCostUSD(r.ingredients, priceBook), [r, priceBook]);
  const costDisplay =
    priceBook ? `~$${live.total.toFixed(2)}` : `$${r.estimatedCost.toFixed(2)}`;

  return (
    <View style={{ padding: 14, borderRadius: 14, backgroundColor: C.card, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: "#eef2f7" }}>
      <Text style={{ fontSize: 16, fontWeight: "700" }}>{r.title}</Text>
      <MetaLine text={`${r.minutes} min · ${costDisplay}/serving`} />
      <MetaLine text={`Needs: ${r.ingredients.join(", ")}`} muted />
      {!!priceBook && live.missing.length > 0 && (
        <Text style={{ color: "#6b7280", marginTop: 4 }}>
          Pricing missing for: {live.missing.slice(0, 3).join(", ")}{live.missing.length > 3 ? "…" : ""}
        </Text>
      )}
      <TouchableOpacity onPress={() => setOpen((v) => !v)}>
        <Text style={{ marginTop: 10, color: C.action, fontWeight: "700" }}>{open ? "Hide steps ▲" : "Show steps ▼"}</Text>
      </TouchableOpacity>
      {open && <Text style={{ marginTop: 8, color: "#374151" }}>This is a quick-match idea. Detailed steps appear for AI recipes or future expansions.</Text>}
    </View>
  );
}

// ---------- Small pill component for ingredients ----------
function Pill({
  label,
  active = false,
  disabled = false,
  onPress
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        marginRight: 8,
        marginBottom: 8,
        backgroundColor: disabled ? "#e5e7eb" : active ? C.action : "#e2e8f0",
        borderWidth: active ? 0 : 1,
        borderColor: "#cbd5e1"
      }}
    >
      <Text style={{ color: disabled ? "#94a3b8" : active ? "#fff" : "#0f172a", fontWeight: "700" }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** Rebuild a raw ingredient string after swapping the ingredient name.
 * Keeps qty/unit if present; otherwise returns just the new name. */
function rebuildRawAfterSwap(raw: string, newName: string): string {
  const m = raw.trim().match(/^([\d]+(?:\s+\d\/\d)?|\d*\.?\d+)?\s*([a-zA-Z]+)?\s*(.*)$/);
  if (!m) return newName;
  const qtyStr = (m[1] ?? "").trim();
  const unitStr = (m[2] ?? "").trim();
  const parts = [];
  if (qtyStr) parts.push(qtyStr);
  if (unitStr) parts.push(unitStr);
  parts.push(newName);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Tiny chip for rationale/tags
function TagChip({ text }: { text: string }) {
  return (
    <View
      style={{
        backgroundColor: "#e2e8f0",
        borderColor: "#cbd5e1",
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        marginRight: 6,
        marginTop: 6
      }}
    >
      <Text style={{ fontSize: 12, color: "#0f172a", fontWeight: "700" }}>{text}</Text>
    </View>
  );
}

// ---------- AI recipe card (uses live cost + substitutions + replace) ----------
function AIRecipeCard({ r, priceBook }: { r: AIRecipe; priceBook?: PriceBook }) {
  // Local, mutable ingredients for this card (so we don't mutate source data)
  const [localIngredients, setLocalIngredients] = useState<string[]>(r.ingredients);

  // ⬅️ NEW: global prefs drive substitution filtering
  const { prefs } = usePrefs();

  // Re-compute cost from localIngredients
  const cost = useMemo(() => estimateRecipeCostUSD(localIngredients, priceBook), [localIngredients, priceBook]);

  // Substitutions UX state
  const [selectedIng, setSelectedIng] = useState<string | null>(null);
  const [subs, setSubs] = useState<Array<{ name: string; notes?: string; tags?: string[] }>>([]);
  const [open, setOpen] = useState(false);

  function handleTapIngredient(raw: string) {
    const parsed = parseIngredient(raw);
    const key = parsed.name;
    if (!hasSubstitutions(key) && !hasSubstitutions(raw)) {
      setSelectedIng(null);
      setSubs([]);
      return;
    }
    const result = getSubstitutions(key, prefs); // <-- filtered by global prefs
    setSelectedIng(raw);
    setSubs(result.slice(0, 8));
  }

  function handleApplySub(subName: string) {
    if (!selectedIng) return;
    const rebuilt = rebuildRawAfterSwap(selectedIng, subName);
    setLocalIngredients(prev => prev.map(ing => (ing === selectedIng ? rebuilt : ing)));
    setSelectedIng(null);
    setSubs([]);
  }

  return (
    <View style={{ padding: 14, borderRadius: 14, backgroundColor: C.card, marginTop: 12, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: "#eef2f7" }}>
      <Text style={{ fontSize: 16, fontWeight: "700" }}>{r.title}</Text>
      <MetaLine text={`${r.minutes} min${priceBook ? ` · ~$${(cost.total).toFixed(2)} est.` : ''}`} />

      {/* Ingredient chips with tap-to-substitute */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
        {localIngredients.map((ing, i) => {
          const parsed = parseIngredient(ing);
          const canSub = hasSubstitutions(parsed.name) || hasSubstitutions(ing);
          const isActive = selectedIng === ing;
          return (
            <Pill
              key={`${ing}-${i}`}
              label={parsed.name}
              active={isActive}
              disabled={!canSub}
              onPress={() => handleTapIngredient(ing)}
            />
          );
        })}
      </View>

      {!!priceBook && cost.missing.length > 0 && (
        <Text style={{ color: "#6b7280", marginTop: 4 }}>
          Pricing missing for: {cost.missing.slice(0, 3).join(", ")}{cost.missing.length > 3 ? "…" : ""}
        </Text>
      )}

      {/* Substitutions panel (appears when an ingredient is tapped) */}
      {selectedIng && subs.length > 0 && (
        <View style={{ marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0" }}>
          <Text style={{ fontWeight: "700", color: "#0f172a" }}>
            Substitute for {parseIngredient(selectedIng).name}
          </Text>
          <Text style={{ color: "#475569", marginTop: 2 }}>
            Tap a substitute to replace it in this recipe.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
            {subs.map((s, idx) => (
              <TouchableOpacity
                key={`${s.name}-${idx}`}
                onPress={() => handleApplySub(s.name)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 12,
                  marginRight: 10,
                  marginBottom: 10,
                  backgroundColor: "#ffffff",
                  borderWidth: 1,
                  borderColor: "#cbd5e1",
                  maxWidth: "100%"
                }}
              >
                <Text style={{ fontWeight: "700", color: "#0f172a" }}>{s.name}</Text>
                {s.notes ? <Text style={{ color: "#475569" }}> · {s.notes}</Text> : null}

                {/* NEW: render reason/tag chips below each option */}
                {Array.isArray(s.tags) && s.tags.length > 0 && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {s.tags.slice(0, 5).map((t, i2) => (
                      <TagChip key={`${t}-${i2}`} text={t} />
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={() => { setSelectedIng(null); setSubs([]); }}>
            <Text style={{ marginTop: 4, color: C.action, fontWeight: "700" }}>Close</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity onPress={() => setOpen((v) => !v)}>
        <Text style={{ marginTop: 10, color: C.action, fontWeight: "700" }}>
          {open ? "Hide steps ▲" : "Show steps ▼"}
        </Text>
      </TouchableOpacity>
      {open && (
        <View style={{ marginTop: 8 }}>
          {r.steps.slice(0, 8).map((s, i) => (
            <Text key={i} style={{ marginTop: i === 0 ? 0 : 6, color: "#374151" }}>
              {i + 1}. {s}
            </Text>
          ))}
          {r.steps.length > 8 ? <Text style={{ marginTop: 6, color: "#6b7280" }}>…and more</Text> : null}
        </View>
      )}
    </View>
  );
}

// ---------- Screen ----------
export default function RecipesScreen() {
  const items = usePantry((s: PantryState) => s.items);
  const ruleMatches = useMemo(() => matchRecipes(items), [items]);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResults, setAiResults] = useState<AIRecipe[]>([]);

  // Live pricing state
  const [zip, setZip] = useState<string>(
    (Constants?.expoConfig?.extra as any)?.EXPO_PUBLIC_DEFAULT_ZIP ?? "45202"
  );
  const [priceBook, setPriceBook] = useState<PriceBook | undefined>(undefined);
  const [priceBusy, setPriceBusy] = useState(false);

  const navigation = useNavigation();
  const router = useRouter();
  const { show, ToastElement } = useToast();
  const { ok, checking, pingNow } = usePing();

  // Derived: how many terms we can actually price
  const pricableTerms = useMemo(() => {
    const terms = new Set<string>();
    if (aiResults.length > 0) {
      for (const r of aiResults) {
        for (const ing of r.ingredients) terms.add(parseIngredient(ing).name);
      }
    } else {
      // fallback: pantry
      for (const p of items) terms.add(normName(p));
    }
    return Array.from(terms).filter(Boolean);
  }, [aiResults, items]);

  const canUpdatePrices = pricableTerms.length > 0;

  // Header: Chef Chat button
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => router.push('/chef-chat')}
          style={{ backgroundColor: C.action, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Chef Chat</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, router]);

  async function handleAskAI() {
    setAiLoading(true);
    try {
      const out = await aiSuggestRecipes(items);
      const list = out.recipes ?? [];
      setAiResults(Array.isArray(list) ? list : []);
      if (out.error) {
        show(`AI issue: ${out.error.replace(/^Local AI request failed:\s*/i, '')}`);
      }
    } catch (e: any) {
      show(`Request failed: ${e?.message ?? e}`);
      setAiResults([]);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleUpdatePrices() {
    if (!canUpdatePrices) {
      show("Nothing to price yet — tap ✨ Ask AI or add pantry items.");
      return;
    }
    if (!zip || zip.length < 5) {
      show("Enter a valid ZIP");
      return;
    }
    try {
      setPriceBusy(true);
      // stats-aware build so UI reflects Certification reality
      const stats = await buildPriceBookWithStats(pricableTerms.slice(0, 40), zip);
      setPriceBook(stats.book);

      const msg =
        `Updated ${stats.inspected} item${stats.inspected === 1 ? '' : 's'} ` +
        `(${stats.priced} priced, ${stats.missing} N/A${(stats as any).failures ? `, ${(stats as any).failures} failed` : ''}) · ${zip}`;
      show(msg);
    } catch (e: any) {
      show(`Pricing error: ${e?.message ?? String(e)}`);
    } finally {
      setPriceBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={T.h1}>Nibble · Recipes</Text>

        {/* Status pill + refresh (manual; no background blinking) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SP.xs }}>
          <View
            style={{
              width: 8, height: 8, borderRadius: 999,
              backgroundColor: ok === true ? '#22c55e' : ok === false ? '#ef4444' : '#f59e0b'
            }}
          />
          <Text style={{ marginLeft: 6, color: '#6b7280' }}>
            {ok === true ? 'Local AI online' : ok === false ? 'AI offline' : 'Checking…'}
          </Text>
          <TouchableOpacity onPress={pingNow} style={{ marginLeft: 10 }}>
            <Text style={{ color: C.action, fontWeight: '700' }}>
              {checking ? '…' : 'Refresh'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Debug lines */}
        <Text style={[T.muted, { marginTop: SP.xs }]}>Debug · AI URL: {OLLAMA_URL || "(missing)"}</Text>
        <Text style={[T.muted, { marginTop: SP.xs }]}>Debug · Pricing URL: {CURRENT_PRICING_URL}</Text>
        <Text style={[T.muted, { marginTop: SP.xs }]}>Pantry: {items.length ? items.join(", ") : "— empty —"}</Text>

        <Divider />

        <Text style={T.h2}>Quick matches</Text>
        {ruleMatches.length === 0 ? (
          <View style={{ marginTop: 10 }}>
            <EmptyState title="No matches yet" subtitle="Go to Scan and add items to your pantry." />
          </View>
        ) : (
          <FlatList
            style={{ marginTop: 12 }}
            data={ruleMatches}
            keyExtractor={(x) => x.id}
            renderItem={({ item }) => <RuleRecipeCard r={item} priceBook={priceBook} />}
            scrollEnabled={false}
          />
        )}

        <Divider />

        <View style={{ padding: 14, borderRadius: 14, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: C.border }}>
          <Text style={T.h2}>AI suggestions</Text>

          <TouchableOpacity
            onPress={handleAskAI}
            disabled={aiLoading}
            style={{
              marginTop: 10,
              alignSelf: "flex-start",
              backgroundColor: aiLoading ? C.actionDisabled : C.action,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>{aiLoading ? "Asking…" : "✨ Ask AI for ideas"}</Text>
          </TouchableOpacity>

          {/* Live pricing ZIP + update */}
          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={zip}
                onChangeText={setZip}
                keyboardType="number-pad"
                maxLength={10}
                placeholder="ZIP"
                placeholderTextColor="#64748b"
                style={{ flex: 0.5, backgroundColor: "#e2e8f0", color: "#0f172a", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}
              />
              <TouchableOpacity
                onPress={handleUpdatePrices}
                disabled={priceBusy || !canUpdatePrices}
                style={{ backgroundColor: (priceBusy || !canUpdatePrices) ? C.actionDisabled : C.action, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 }}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  {priceBusy ? "Updating…" : "🔄 Update Prices"}
                </Text>
              </TouchableOpacity>
            </View>
            {!canUpdatePrices && (
              <Text style={{ color: "#6b7280", marginTop: 6 }}>
                No ingredients yet — tap ✨ Ask AI or add items to your pantry.
              </Text>
            )}
          </View>

          {aiLoading && (
            <View style={{ marginTop: 12 }}>
              <Shimmer height={96} />
              <Shimmer height={96} />
              <Shimmer height={96} />
            </View>
          )}

          {!aiLoading && aiResults.length === 0 && (
            <View style={{ marginTop: 10 }}>
              <EmptyState title="No AI ideas yet" subtitle="Tap the button to generate ideas tailored to your pantry." />
            </View>
          )}

          {!aiLoading && aiResults.length > 0 && (
            <View style={{ marginTop: 6 }}>
              {aiResults.map((r, i) => <AIRecipeCard key={i} r={r} priceBook={priceBook} />)}
            </View>
          )}
        </View>
      </ScrollView>

      {ToastElement}
    </View>
  );
}


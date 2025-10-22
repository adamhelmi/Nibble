// app/lib/mathEngine.ts
// Deterministic conversions, scaling, and cost math for Nibble.

import { normalize as normName, type PriceBook } from "./livePricing";

export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'tbsp' | 'tsp' | 'cup' | 'unit';

export type Ingredient = {
  name: string;      // "milk"
  qty: number;       // numeric quantity
  unit: Unit;        // unit of qty
};

// --- Unit system --------------------------------------------------------------

const MASS_UNITS = new Set<Unit>(['g', 'kg']);
const VOL_UNITS  = new Set<Unit>(['ml', 'l', 'tbsp', 'tsp', 'cup']);
const COUNT_UNITS= new Set<Unit>(['unit']);

// Base units: grams (g), milliliters (ml), unit (unit).
const TBSP_TO_ML = 15;
const TSP_TO_ML  = 5;
const CUP_TO_ML  = 240;

export function normalizeUnit(u: string): Unit {
  const x = u.trim().toLowerCase();
  if (x === 'gram' || x === 'grams') return 'g';
  if (x === 'kilogram' || x === 'kilograms' || x === 'kgs') return 'kg';
  if (x === 'milliliter' || x === 'milliliters' || x === 'cc') return 'ml';
  if (x === 'liter' || x === 'liters') return 'l';
  if (x === 'tablespoon' || x === 'tablespoons') return 'tbsp';
  if (x === 'teaspoon' || x === 'teaspoons') return 'tsp';
  if (x === 'cups') return 'cup';
  if (x === 'piece' || x === 'pieces' || x === 'pc' || x === 'pcs' || x === 'ea' || x === 'each' || x === 'whole') return 'unit';
  if (['g','kg','ml','l','tbsp','tsp','cup','unit'].includes(x)) return x as Unit;
  // Default to unit if unknown (explicit, not silent)
  return 'unit';
}

function isMass(u: Unit) { return MASS_UNITS.has(u); }
function isVol(u: Unit)  { return VOL_UNITS.has(u); }
function isCnt(u: Unit)  { return COUNT_UNITS.has(u); }

/**
 * Convert a quantity between units within the same dimension.
 * Base units: g, ml, unit. Throws on cross-dimension conversion.
 */
export function convert(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;

  // Mass
  if (isMass(from) && isMass(to)) {
    // normalize to g
    const g = (from === 'kg') ? value * 1000 : value;
    return (to === 'kg') ? g / 1000 : g;
  }

  // Volume
  if (isVol(from) && isVol(to)) {
    // normalize to ml
    let ml = 0;
    switch (from) {
      case 'l':    ml = value * 1000; break;
      case 'ml':   ml = value; break;
      case 'tbsp': ml = value * TBSP_TO_ML; break;
      case 'tsp':  ml = value * TSP_TO_ML; break;
      case 'cup':  ml = value * CUP_TO_ML; break;
    }
    switch (to) {
      case 'l':    return ml / 1000;
      case 'ml':   return ml;
      case 'tbsp': return ml / TBSP_TO_ML;
      case 'tsp':  return ml / TSP_TO_ML;
      case 'cup':  return ml / CUP_TO_ML;
    }
  }

  // Count
  if (isCnt(from) && isCnt(to)) return value;

  throw new Error(`Incompatible unit conversion: ${from} → ${to}`);
}

/**
 * Scale a recipe's ingredient list by a ratio (e.g., 2x, 0.5x).
 * Quantities are scaled, units preserved.
 */
export function scaleRecipe(ratio: number, ingredients: Ingredient[]): Ingredient[] {
  if (!isFinite(ratio) || ratio <= 0) throw new Error(`Invalid scale ratio ${ratio}`);
  return ingredients.map(i => ({
    ...i,
    qty: +(i.qty * ratio).toFixed(4),
  }));
}

// --- Pricing & Cost -----------------------------------------------------------

/**
 * Aligns a free-text ingredient name to a priceable key.
 * Mirrors the UI-side normalization heuristics.
 */
export function toPriceKey(name: string): string {
  // strip common descriptors to improve hit rate
  const cleaned = normName(
    name.replace(/\b(fresh|chopped|diced|minced|boneless|skinless|large|small|organic)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
  );
  return cleaned;
}

/**
 * Compute total cost using a PriceBook (price per unit of its own unit).
 * Will convert ingredient quantities into the price unit when possible.
 * Returns a number rounded to cents.
 */
export function totalCost(ingredients: Ingredient[], priceBook: PriceBook): number {
  let total = 0;
  for (const ing of ingredients) {
    const key = toPriceKey(ing.name);
    const price = priceBook[key];
    if (!price) continue; // missing pricing → skip

    // Attempt unit alignment
    // price.amount is $ per price.unit
    let qtyInPriceUnit: number | null = null;
    try {
      qtyInPriceUnit = convert(ing.qty, ing.unit, price.unit as Unit);
    } catch {
      // incompatible dimensions → skip
      qtyInPriceUnit = null;
    }
    if (qtyInPriceUnit == null) continue;

    total += qtyInPriceUnit * price.amount;
  }
  return +total.toFixed(2);
}

/**
 * Per-ingredient cost breakdown for UX/debug.
 */
export function costBreakdown(
  ingredients: Ingredient[],
  priceBook: PriceBook
): Array<{ name: string; qty: number; unit: Unit; unitPricedAs?: Unit; cost?: number }> {
  const rows: Array<{ name: string; qty: number; unit: Unit; unitPricedAs?: Unit; cost?: number }> = [];
  for (const ing of ingredients) {
    const key = toPriceKey(ing.name);
    const price = priceBook[key];
    if (!price) { rows.push({ name: ing.name, qty: ing.qty, unit: ing.unit }); continue; }
    try {
      const q = convert(ing.qty, ing.unit, price.unit as Unit);
      const cost = +(q * price.amount).toFixed(2);
      rows.push({ name: ing.name, qty: ing.qty, unit: ing.unit, unitPricedAs: price.unit as Unit, cost });
    } catch {
      rows.push({ name: ing.name, qty: ing.qty, unit: ing.unit });
    }
  }
  return rows;
}

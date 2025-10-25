// lib/mathEngine.ts
// Deterministic conversions, scaling, cost math, and local analytical reasoning for Nibble.

import { normalize as normName, type PriceBook } from "./livePricing";
import { getSubstitutions } from "./substitutions";
import type { Prefs } from "./prefs";
import { DEFAULT_PREFS } from "./prefs";

// --- Core Types ---------------------------------------------------------------

export type Unit = "g" | "kg" | "ml" | "l" | "tbsp" | "tsp" | "cup" | "unit";

export type Ingredient = {
  name: string;
  qty: number;
  unit: Unit;
};

// --- Unit System --------------------------------------------------------------

const MASS_UNITS = new Set<Unit>(["g", "kg"]);
const VOL_UNITS = new Set<Unit>(["ml", "l", "tbsp", "tsp", "cup"]);
const COUNT_UNITS = new Set<Unit>(["unit"]);

const TBSP_TO_ML = 15;
const TSP_TO_ML = 5;
const CUP_TO_ML = 240;

export function normalizeUnit(u: string): Unit {
  const x = u.trim().toLowerCase();
  if (x === "gram" || x === "grams") return "g";
  if (x === "kilogram" || x === "kilograms" || x === "kgs") return "kg";
  if (x === "milliliter" || x === "milliliters" || x === "cc") return "ml";
  if (x === "liter" || x === "liters") return "l";
  if (x === "tablespoon" || x === "tablespoons") return "tbsp";
  if (x === "teaspoon" || x === "teaspoons") return "tsp";
  if (x === "cups") return "cup";
  if (["piece","pieces","pc","pcs","ea","each","whole"].includes(x)) return "unit";
  if (["g", "kg", "ml", "l", "tbsp", "tsp", "cup", "unit"].includes(x)) return x as Unit;
  return "unit";
}

function isMass(u: Unit) { return MASS_UNITS.has(u); }
function isVol(u: Unit)  { return VOL_UNITS.has(u); }
function isCnt(u: Unit)  { return COUNT_UNITS.has(u); }

export function convert(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;

  if (isMass(from) && isMass(to)) {
    const g = from === "kg" ? value * 1000 : value;
    return to === "kg" ? g / 1000 : g;
  }

  if (isVol(from) && isVol(to)) {
    let ml = 0;
    switch (from) {
      case "l":   ml = value * 1000; break;
      case "ml":  ml = value; break;
      case "tbsp": ml = value * TBSP_TO_ML; break;
      case "tsp":  ml = value * TSP_TO_ML; break;
      case "cup":  ml = value * CUP_TO_ML; break;
    }
    switch (to) {
      case "l":   return ml / 1000;
      case "ml":  return ml;
      case "tbsp": return ml / TBSP_TO_ML;
      case "tsp":  return ml / TSP_TO_ML;
      case "cup":  return ml / CUP_TO_ML;
    }
  }

  if (isCnt(from) && isCnt(to)) return value;

  throw new Error(`Incompatible unit conversion: ${from} → ${to}`);
}

// --- Scaling ------------------------------------------------------------------

export function scaleRecipe(ratio: number, ingredients: Ingredient[]): Ingredient[] {
  if (!isFinite(ratio) || ratio <= 0) throw new Error(`Invalid scale ratio ${ratio}`);
  return ingredients.map(i => ({ ...i, qty: +(i.qty * ratio).toFixed(4) }));
}

// --- Pricing ------------------------------------------------------------------

export function toPriceKey(name: string): string {
  const cleaned = normName(
    name
      .replace(/\b(fresh|chopped|diced|minced|boneless|skinless|large|small|organic)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  );
  return cleaned;
}

export function totalCost(ingredients: Ingredient[], priceBook: PriceBook): number {
  let total = 0;
  for (const ing of ingredients) {
    const key = toPriceKey(ing.name);
    const price = priceBook[key];
    if (!price) continue;
    let qtyInPriceUnit: number | null = null;
    try { qtyInPriceUnit = convert(ing.qty, ing.unit, price.unit as Unit); }
    catch { qtyInPriceUnit = null; }
    if (qtyInPriceUnit == null) continue;
    total += qtyInPriceUnit * price.amount;
  }
  return +total.toFixed(2);
}

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

// --- Analytical Math & Needed/Available --------------------------------------

function parseFraction(s: string): number {
  const parts = s.trim().split(/\s+/);
  let total = 0;
  for (const p of parts) {
    if (p.includes("/")) {
      const [a, b] = p.split("/");
      const n = parseFloat(a), d = parseFloat(b);
      if (isFinite(n) && isFinite(d) && d !== 0) total += n / d;
    } else {
      const n = parseFloat(p);
      if (isFinite(n)) total += n;
    }
  }
  return total || 0;
}

function tokenize(expr: string): string[] {
  let x = expr
    .replace(/[×x]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/,/g, "")
    .replace(/%\s*(?=[\d(]|$)/g, "%");
  if (/[^0-9+\-*/^().%\s]/.test(x)) {
    x = x.replace(/[a-zA-Z]+/g, " ").replace(/\s+/g, " ").trim();
    if (/[^0-9+\-*/^().%\s]/.test(x)) throw new Error("Unsupported characters in expression");
  }
  const tokens: string[] = [];
  const re = /(\d+(?:\.\d+)?%?|\(|\)|\+|\-|\*|\/|\^)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(x)) !== null) tokens.push(m[1]);
  return tokens;
}

function toRPN(tokens: string[]): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  const prec: Record<string, number> = { "^": 4, "*": 3, "/": 3, "+": 2, "-": 2 };
  const rightAssoc = new Set<string>(["^"]);
  for (const t of tokens) {
    if (/^\d/.test(t)) {
      if (t.endsWith("%")) { const n = parseFloat(t.slice(0, -1)); out.push(String(n / 100)); }
      else out.push(t);
    } else if (t in prec) {
      while (stack.length && stack[stack.length - 1] in prec &&
            ((rightAssoc.has(t) && prec[t] < prec[stack[stack.length - 1]]) ||
             (!rightAssoc.has(t) && prec[t] <= prec[stack[stack.length - 1]])))
        out.push(stack.pop() as string);
      stack.push(t);
    } else if (t === "(") stack.push(t);
    else if (t === ")") {
      while (stack.length && stack[stack.length - 1] !== "(") out.push(stack.pop() as string);
      if (!stack.length) throw new Error("Mismatched parentheses");
      stack.pop();
    }
  }
  while (stack.length) {
    const op = stack.pop() as string;
    if (op === "(" || op === ")") throw new Error("Mismatched parentheses");
    out.push(op);
  }
  return out;
}

function evalRPN(rpn: string[]): number {
  const st: number[] = [];
  for (const t of rpn) {
    if (/^\-?\d+(\.\d+)?$/.test(t)) { st.push(parseFloat(t)); continue; }
    const b = st.pop(); const a = st.pop();
    if (a === undefined || b === undefined) throw new Error("Bad expression");
    switch (t) {
      case "+": st.push(a + b); break;
      case "-": st.push(a - b); break;
      case "*": st.push(a * b); break;
      case "/": st.push(a / b); break;
      case "^": st.push(Math.pow(a, b)); break;
      default: throw new Error("Unknown operator");
    }
  }
  if (st.length !== 1 || !isFinite(st[0])) throw new Error("Bad expression");
  return st[0];
}

export function safeEvalExpression(expr: string): number {
  const tokens = tokenize(expr);
  const rpn = toRPN(tokens);
  const out = evalRPN(rpn);
  return +out.toFixed(6);
}

type Qty = { value: number; unit: Unit };

function parseQty(s: string): Qty | null {
  const m = s.trim().match(/^([\d\.\s\/]+)\s*([a-zA-Z]+)?$/);
  if (!m) return null;
  const qty = parseFraction(m[1]);
  const unit = m[2] ? normalizeUnit(m[2]) : "unit";
  return { value: qty, unit };
}

export function analyzeNeededAvailable(text: string): { ok: boolean; message?: string } {
  const neededMatch = text.match(/needed\s*:\s*([^\n\r]+)/i);
  const availMatch  = text.match(/available\s*:\s*([^\n\r]+)/i);
  if (!neededMatch || !availMatch) return { ok: false };
  const needed = parseQty(neededMatch[1]);
  const avail  = parseQty(availMatch[1]);
  if (!needed || !avail) return { ok: false };
  let availInNeeded = avail.value;
  try { availInNeeded = convert(avail.value, avail.unit, needed.unit); } catch {}
  const shortage = +(needed.value - availInNeeded).toFixed(4);
  const pct = needed.value > 0 ? +((Math.max(shortage, 0) / needed.value) * 100).toFixed(2) : 0;
  const unit = needed.unit;
  const lines = [
    `Needed: ${needed.value}${unit !== "unit" ? unit : ""}`,
    `Available: ${availInNeeded}${unit !== "unit" ? unit : ""}`,
    `Shortage: ${Math.max(shortage, 0)}${unit !== "unit" ? unit : ""} (${needed.value} - ${availInNeeded})`,
    ``,
    `Percentage short: ${pct}%`,
  ];
  return { ok: true, message: lines.join("\n") };
}

// --- Analytical + Substitution Reasoning -------------------------------------

export function detectMathIntent(text: string): "needed_available" | "calc" | null {
  if (/needed\s*:/.test(text) && /available\s*:/.test(text)) return "needed_available";
  if (/[+\-*/^()%×÷]/.test(text)) return "calc";
  if (/\b(g|kg|ml|l|tbsp|tsp|cup|cups|grams|liters|milliliters)\b/i.test(text)) return "calc";
  return null;
}

export function analyticalReply(text: string): string | null {
  const kind = detectMathIntent(text);
  if (kind === "needed_available") {
    const res = analyzeNeededAvailable(text);
    if (res.ok && res.message) return res.message;
  }
  if (kind === "calc") {
    try {
      const expr = text
        .replace(/[a-zA-Z]+/g, " ")
        .replace(/×/g, "*")
        .replace(/÷/g, "/")
        .replace(/,/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const val = safeEvalExpression(expr);
      return `Result: ${val}`;
    } catch {}
  }
  return null;
}

// --- Substitution Reply ------------------------------------------------------

export function substitutionReply(text: string, prefs?: Partial<Prefs>): string | null {
  const patterns = [
    /substitute for ([a-z\s]+)/i,
    /replace ([a-z\s]+) with/i,
    /alternative to ([a-z\s]+)/i,
    /instead of ([a-z\s]+)/i,
    /swap ([a-z\s]+) for/i,
  ];
  let target: string | null = null;
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) { target = m[1].trim(); break; }
  }
  if (!target) return null;

  const p: Prefs = { ...DEFAULT_PREFS, ...(prefs ?? {}) };
  const subs = getSubstitutions(target, p);
  if (!subs.length) return null;

  const lines = [`Substitutes for **${target}**:`];
  for (const s of subs.slice(0, 4)) {
    const tags = s.tags?.length ? ` (${s.tags.join(", ")})` : "";
    const note = s.notes ? ` — ${s.notes}` : "";
    lines.push(`• ${s.name}${tags}${note}`);
  }
  return lines.join("\n");
}

// --- Unified Deterministic Router --------------------------------------------

export function localReasoningReply(text: string, prefs?: Partial<Prefs>): string | null {
  return substitutionReply(text, prefs) || analyticalReply(text);
}



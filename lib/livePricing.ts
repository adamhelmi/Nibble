// lib/livePricing.ts
import Constants from 'expo-constants';

export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'tbsp' | 'tsp' | 'cup' | 'unit';
export type PricePer = { unit: Unit; amount: number };
export type PriceBook = Record<string, PricePer>;

const PRICING_URL: string =
  ((Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_PRICING_URL as string) ||
  'http://localhost:5057';
export const CURRENT_PRICING_URL = PRICING_URL; // for on-screen debug

function toNumber(s: string) {
  const m = String(s).replace(',', '.').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : NaN;
}

function parseSizeToUnit(size?: string): { qty: number; unit: Unit } | null {
  if (!size) return null;
  const s = size.toLowerCase().replace(/\s+/g, ' ').trim();
  if (s.includes('lb')) return { qty: toNumber(s) * 453.592, unit: 'g' };
  if (s.includes('oz')) return { qty: toNumber(s) * 28.3495, unit: 'g' };
  if (s.includes('kg')) return { qty: toNumber(s) * 1000, unit: 'g' };
  if (s.includes('g'))  return { qty: toNumber(s), unit: 'g' };
  if (s.includes('l ') || s.endsWith('l'))  return { qty: toNumber(s) * 1000, unit: 'ml' };
  if (s.includes('ml')) return { qty: toNumber(s), unit: 'ml' };
  if (s.includes('ea') || s.includes('ct') || s.includes('each')) return { qty: 1, unit: 'unit' };
  return null;
}

export function normalize(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export type PricingResponse = {
  store: { id?: string; name?: string; zipcode?: string } | null;
  products: Array<{
    upc: string;
    description: string;
    category?: string | null;
    size?: string | null;
    price?: number | null;
    promo?: number | null;
    unitPrice?: number | null;
    unitPriceDisplay?: string | null;
    packageSize?: string | null;
  }>;
};

function withTimeout<T>(p: Promise<T>, ms = 8000) {
  return Promise.race([
    p,
    new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), ms)),
  ]);
}

export async function searchLivePrice(term: string, zip: string): Promise<PricingResponse> {
  const url = `${PRICING_URL}/pricing/search?q=${encodeURIComponent(term)}&zip=${encodeURIComponent(zip)}&limit=12`;
  const res = await withTimeout(fetch(url), 8000);
  if (!res.ok) throw new Error(`pricing search failed: ${res.status}`);
  return await res.json();
}

export type PriceBookStats = {
  book: PriceBook;
  inspected: number;
  priced: number;
  missing: number;
  failures: number;
  samples: Array<{ term: string; name: string; size: string | null; priceDisplay: string }>;
};

export async function buildPriceBookWithStats(
  terms: string[],
  zip: string
): Promise<PriceBookStats> {
  const book: PriceBook = {};
  let inspected = 0;
  let priced = 0;
  let failures = 0;
  const samples: PriceBookStats['samples'] = [];

  for (const t of terms) {
    try {
      const data = await searchLivePrice(t, zip);
      const products = data?.products || [];
      inspected += products.length;

      let best: { unit: Unit; amount: number } | null = null;

      for (const p of products) {
        const numeric = [p.promo, p.price, p.unitPrice].find(v => typeof v === 'number') as number | undefined;
        const hasNumeric = typeof numeric === 'number' && isFinite(numeric);
        const sizeMeta = parseSizeToUnit(p.packageSize || p.size || undefined);
        const qty = sizeMeta?.qty ?? 0;

        const display =
          hasNumeric ? `$${(numeric as number).toFixed(2)}` :
          (p.unitPriceDisplay ?? 'N/A');

        samples.push({
          term: t,
          name: p.description,
          size: p.packageSize ?? p.size ?? null,
          priceDisplay: display
        });

        if (!hasNumeric || !sizeMeta || qty <= 0) continue;

        priced++;
        const unitAmount = numeric! / qty;
        if (!best || unitAmount < best.amount) {
          best = { unit: sizeMeta.unit, amount: +unitAmount.toFixed(6) };
        }
      }

      if (best) {
        book[normalize(t)] = best;
      }
    } catch {
      failures += 1; // network/CORS/timeout/etc.
    }
  }

  return { book, inspected, priced, missing: inspected - priced, failures, samples };
}

export async function buildPriceBook(terms: string[], zip: string): Promise<PriceBook> {
  const { book } = await buildPriceBookWithStats(terms, zip);
  return book;
}

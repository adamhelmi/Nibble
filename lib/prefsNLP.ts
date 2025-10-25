// lib/prefsNLP.ts
// Deterministic preference extraction from natural language.
// Scope: diet, religious rules, allergens (top list), dislikes (simple).

import type { Prefs } from './prefs';

const DIETS = [
  'vegan','vegetarian','pescatarian','omnivore','keto','paleo','mediterranean','low-carb','low fat','low-fat','whole30','carnivore'
];

const RELIGIOUS = ['halal','kosher'];

const ALLERGENS = [
  'dairy','milk','cheese','butter','egg','eggs','peanut','peanuts','tree nut','tree nuts','almond','walnut','pecan','hazelnut','pistachio','cashew',
  'soy','soya','wheat','gluten','sesame','fish','shellfish','shrimp','prawn','lobster','crab','mollusk','mustard','celery','lupin','sulfites','sulphites'
];

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function normalizeAllergen(a: string): string | null {
  const t = a.toLowerCase().trim();
  if (['milk','cheese','butter','yogurt','whey','casein','dairy'].includes(t)) return 'dairy';
  if (['egg','eggs','albumen'].includes(t)) return 'egg';
  if (['peanut','peanuts'].includes(t)) return 'peanut';
  if (['tree nut','tree nuts','almond','walnut','pecan','hazelnut','pistachio','cashew'].includes(t)) return 'tree nut';
  if (['soya','soy','soybean','tofu','edamame'].includes(t)) return 'soy';
  if (['wheat','gluten','barley','rye','semolina'].includes(t)) return 'gluten';
  if (['sesame','tahini'].includes(t)) return 'sesame';
  if (['fish','salmon','tuna','cod','anchovy','sardine'].includes(t)) return 'fish';
  if (['shellfish','shrimp','prawn','lobster','crab','mollusk','crustacean'].includes(t)) return 'shellfish';
  if (['mustard'].includes(t)) return 'mustard';
  if (['celery'].includes(t)) return 'celery';
  if (['lupin'].includes(t)) return 'lupin';
  if (['sulfites','sulphites'].includes(t)) return 'sulfites';
  return null;
}

export function extractPrefsFromText(text: string): {
  found: boolean;
  patch: Partial<Prefs>;
  chips: string[];
} {
  const s = ` ${text.toLowerCase()} `;

  const patch: Partial<Prefs> = {};
  const chips: string[] = [];

  // Diet
  for (const d of DIETS) {
    if (s.includes(` ${d} `) || s.includes(` ${d}.`) || s.includes(`${d},`)) {
      if (d === 'low fat') patch.diet = 'omnivore';
      else if (d === 'omnivore') patch.diet = 'omnivore';
      else if (d === 'vegan') patch.diet = 'vegan';
      else if (d === 'vegetarian') patch.diet = 'vegetarian';
      else if (d === 'pescatarian') patch.diet = 'pescatarian';
      else if (d === 'keto') patch.diet = 'keto';
      else if (d === 'paleo') patch.diet = 'paleo';
      else {
        // For diets we don't model explicitly, leave diet as-is and push to dislikes/allergens handling.
      }
      if (patch.diet) chips.push(patch.diet.charAt(0).toUpperCase() + patch.diet.slice(1));
      break;
    }
  }

  // Religious
  for (const r of RELIGIOUS) {
    if (s.includes(` ${r} `) || s.includes(`${r}-`) || s.includes(`${r}.`)) {
      patch.religious = r as any;
      chips.push(r.charAt(0).toUpperCase() + r.slice(1));
      break;
    }
  }

  // Allergen detection
  const allergenHits: string[] = [];
  for (const a of ALLERGENS) {
    if (s.includes(` ${a} `) || s.includes(`${a},`) || s.includes(`${a}.`)) {
      const norm = normalizeAllergen(a);
      if (norm) allergenHits.push(norm);
    }
  }

  // Phrases like "allergic to X", "no X", "avoid X"
  const allergyRegexes = [
    /allergic to ([a-z ,\-]+)/g,
    /no ([a-z ,\-]+)(?=$|\.)/g,
    /avoid ([a-z ,\-]+)(?=$|\.)/g,
  ];
  for (const rx of allergyRegexes) {
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = rx.exec(s))) {
      const tokens = m[1].split(/[, ]+/).map(t => t.trim()).filter(Boolean);
      for (const t of tokens) {
        const norm = normalizeAllergen(t);
        if (norm) allergenHits.push(norm);
      }
    }
  }
  if (allergenHits.length) {
    patch.allergens = uniq(allergenHits);
    chips.push(...patch.allergens.map(a => `No ${a}`));
  }

  // Dislikes — catch “dislike X”, “no cilantro”, “hate X”
  const dislikeHits: string[] = [];
  const dislikeRegexes = [
    /dislike ([a-z\- ]+?)(?=,|\.|$)/g,
    /hate ([a-z\- ]+?)(?=,|\.|$)/g,
  ];
  for (const rx of dislikeRegexes) {
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = rx.exec(s))) {
      const item = m[1].trim();
      if (item && !ALLERGENS.includes(item)) dislikeHits.push(item);
    }
  }
  // “no cilantro” gets captured as allergen pattern above; if it wasn't normalized, treat as dislike
  const noX = /no ([a-z\- ]+?)(?=,|\.|$)/g;
  let m2: RegExpExecArray | null;
  while ((m2 = noX.exec(s))) {
    const item = m2[1].trim();
    if (item && !normalizeAllergen(item)) dislikeHits.push(item);
  }
  if (dislikeHits.length) {
    (patch.dislikes ??= []);
    for (const d of dislikeHits) (patch.dislikes as string[]).push(d);
  }
  if (patch.dislikes?.length) chips.push(...uniq(patch.dislikes).map(d => `No ${d}`));

  const found = Boolean(patch.diet || patch.religious || (patch.allergens?.length) || (patch.dislikes?.length));
  return { found, patch, chips: uniq(chips) };
}

export function chipsForPrefs(p: Prefs): string[] {
  const chips: string[] = [];
  if (p.diet && p.diet !== 'omnivore') chips.push(p.diet[0].toUpperCase() + p.diet.slice(1));
  if (p.religious && p.religious !== 'none') chips.push(p.religious[0].toUpperCase() + p.religious.slice(1));
  if (p.allergens?.length) chips.push(...p.allergens.map(a => `No ${a}`));
  if (p.dislikes?.length) chips.push(...p.dislikes.map(d => `No ${d}`));
  return chips;
}

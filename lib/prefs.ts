// lib/prefs.ts
// Global Preference Memory: persistent, app-wide, and fast.
// Tiny observable store (no Provider) + AsyncStorage + hooks.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Expand Diet to include all values referenced by substitutions.ts
export type Diet =
  | 'omnivore'
  | 'vegetarian'
  | 'vegan'
  | 'pescatarian'
  | 'keto'
  | 'paleo';

export type Prefs = {
  diet: Diet;
  allergens: string[];          // ["dairy","soy","gluten","nut","egg", ...]
  dislikes: string[];           // free-text blocks e.g. ["cilantro","coconut"]
  preferredUnits: 'metric' | 'imperial';
  zip?: string;                 // preferred ZIP for pricing search
  religious?: 'none' | 'halal' | 'kosher';
  // Coarse spice tolerance; support both numeric + label forms for flexibility
  spiceTolerance?: 0 | 1 | 2 | 'low' | 'medium' | 'high';
};

export const DEFAULT_PREFS: Prefs = {
  diet: 'omnivore',
  allergens: [],
  dislikes: [],
  preferredUnits: 'metric',
  zip: undefined,
  religious: 'none',
  spiceTolerance: 1, // medium
};

const STORAGE_KEY = 'nibble-prefs-v1';

// ---- Tiny observable store ---------------------------------------------------

let state: Prefs = { ...DEFAULT_PREFS };
const subs = new Set<() => void>();
let loaded = false;

function emit() { subs.forEach(fn => fn()); }

async function load(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...DEFAULT_PREFS, ...parsed };
    }
  } catch {
    // ignore; keep defaults
  } finally {
    loaded = true;
  }
}

async function save(): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { /* ignore */ }
}

// ---- Public API --------------------------------------------------------------

export async function ensurePrefsLoaded(): Promise<void> {
  await load();
}

export function getPrefs(): Prefs {
  return state;
}

export async function updatePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  await load();
  state = { ...state, ...patch };
  await save();
  emit();
  return state;
}

export async function resetPrefs(): Promise<void> {
  state = { ...DEFAULT_PREFS };
  await save();
  emit();
}

// ---- React hooks -------------------------------------------------------------

export function usePrefs(): { prefs: Prefs } {
  const subscribe = (cb: () => void) => { subs.add(cb); return () => subs.delete(cb); };
  const getSnapshot = () => state;
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { prefs };
}

export function useUpdatePrefs(): (patch: Partial<Prefs>) => Promise<Prefs> {
  return updatePrefs;
}



// store/usePantry.ts
// PURPOSE:
// - Central, shared state for “what’s in the pantry” so ANY screen can read/write it.
// - Uses Zustand (small state manager) to keep it simple.
//
// EXPORTED:
// - type PantryState: describes shape of the store (so TypeScript knows types)
// - default export usePantry(): a hook that lets screens get/set pantry data

import { create } from "zustand";

// Describe the shape of our pantry store (TypeScript type)
export type PantryState = {
  items: string[];                 // list of ingredients, e.g., ["eggs", "milk"]
  addItems: (arr: string[]) => void; // add multiple items at once
  clear: () => void;                 // wipe everything
};

// Create the store (like a tiny in-memory DB)
const usePantry = create<PantryState>((set) => ({
  items: [],

  // Merge new items; lower-case and dedupe to keep it tidy
  addItems: (arr) =>
    set((s) => ({
      items: Array.from(
        new Set([...s.items, ...arr.map((x) => x.toLowerCase())])
      ),
    })),

  // Reset to empty
  clear: () => set({ items: [] }),
}));

export default usePantry;

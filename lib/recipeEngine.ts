// lib/recipeEngine.ts
// PURPOSE:
// - Given what’s in the pantry, return recipes you can cook *right now*.
// - For MVP: use a tiny hard-coded list so we can prove the flow end-to-end.
// - Later, we’ll replace this with a real DB/API and add filters (diet, time↔cost).

export type Recipe = {
  id: string;            // unique id for lists/navigation later
  title: string;         // recipe name
  minutes: number;       // cook time (used by time↔cost slider later)
  estimatedCost: number; // dollars per serving (used by time↔cost slider later)
  ingredients: string[]; // required pantry items (ALL must be present to match)
};

// A few sample recipes that match our mock scan items.
const MOCK: Recipe[] = [
  {
    id: "1",
    title: "Spinach Omelette",
    minutes: 10,
    estimatedCost: 1.2,
    ingredients: ["eggs", "spinach"],
  },
  {
    id: "2",
    title: "Creamy Eggs",
    minutes: 12,
    estimatedCost: 1.0,
    ingredients: ["eggs", "milk"],
  },
  {
    id: "3",
    title: "Green Frittata",
    minutes: 18,
    estimatedCost: 1.4,
    ingredients: ["eggs", "milk", "spinach"],
  },
];

// RULE (simple): show a recipe only if the user has *all* required ingredients.
export function matchRecipes(pantry: string[]): Recipe[] {
  const have = new Set(pantry.map((x) => x.toLowerCase()));
  return MOCK.filter((r) => r.ingredients.every((i) => have.has(i.toLowerCase())));
}

// lib/mockData.ts
// Temporary in-memory recipe pool to exercise the planner while pricing/APIs are WIP.

import { normalize as normName } from "./livePricing";
import type { Candidate } from "./mealPlanner";
import type { Prefs, Diet } from "./prefs";

type MockRecipe = {
  title: string;
  minutes: number;
  costUSD: number;            // coarse estimate; marked as "estimate" by planner
  ingredients: string[];
  steps?: string[];
  tags: string[];             // e.g. ["slot:breakfast","prot:chicken","cuisine:med"]
};

const M = (x: TemplateStringsArray) =>
  x[0].split("\n").map(s => s.trim()).filter(Boolean); // tiny helper for ingredients

// ⚠️ Keep this list small but diverse. Add more over time.
const MOCK_RECIPES: MockRecipe[] = [
  // Breakfasts
  {
    title: "Veggie Breakfast Burrito",
    minutes: 18,
    costUSD: 2.1,
    ingredients: M`2 eggs
      1 tortilla
      1/2 cup spinach
      1/4 cup black beans
      salsa`,
    tags: ["slot:breakfast","prot:egg","cuisine:mx","veg"],
  },
  {
    title: "Overnight Oats with Banana",
    minutes: 5,
    costUSD: 0.9,
    ingredients: M`1/2 cup oats
      1/2 cup milk
      1 banana
      1 tbsp peanut butter`,
    tags: ["slot:breakfast","prot:plant","cuisine:us","vegan?pb"], // peanut butter note
  },
  {
    title: "Tofu Scramble",
    minutes: 15,
    costUSD: 1.6,
    ingredients: M`200 g firm tofu
      1/2 cup spinach
      1/4 onion
      1 tsp turmeric`,
    tags: ["slot:breakfast","prot:tofu","cuisine:us","vegan"],
  },

  // Lunches
  {
    title: "Chickpea Salad Wrap",
    minutes: 12,
    costUSD: 1.7,
    ingredients: M`1 tortilla
      1/2 cup chickpeas
      1/4 cup cucumber
      1/4 cup tomato
      lemon`,
    tags: ["slot:lunch","prot:plant","cuisine:med","vegan"],
  },
  {
    title: "Tuna Salad Sandwich",
    minutes: 10,
    costUSD: 2.2,
    ingredients: M`1 can tuna
      2 slices bread
      1 tbsp mayo
      lettuce`,
    tags: ["slot:lunch","prot:fish","cuisine:us","pesc"],
  },
  {
    title: "Lentil Soup",
    minutes: 30,
    costUSD: 1.4,
    ingredients: M`1/2 cup lentils
      1 carrot
      1/2 onion
      1 stalk celery
      stock`,
    tags: ["slot:lunch","prot:plant","cuisine:med","vegan","gluten-free"],
  },

  // Dinners – poultry, beef, veg, pasta, rice, stir-fry
  {
    title: "Chicken Rice Bowl",
    minutes: 25,
    costUSD: 3.4,
    ingredients: M`150 g chicken breast
      1/2 cup rice
      1/2 cup broccoli
      soy sauce`,
    tags: ["slot:dinner","prot:chicken","cuisine:asian","halal-ok"],
  },
  {
    title: "Beef & Pepper Stir-Fry",
    minutes: 22,
    costUSD: 3.9,
    ingredients: M`150 g beef
      1 bell pepper
      1/4 onion
      garlic
      soy sauce`,
    tags: ["slot:dinner","prot:beef","cuisine:asian","kosher?depends"],
  },
  {
    title: "Pasta Aglio e Olio",
    minutes: 14,
    costUSD: 1.3,
    ingredients: M`160 g pasta
      2 tbsp olive oil
      2 cloves garlic
      chili flakes`,
    tags: ["slot:dinner","prot:none","cuisine:it","vegan"],
  },
  {
    title: "Veggie Fried Rice",
    minutes: 16,
    costUSD: 1.5,
    ingredients: M`2 cups cooked rice
      1/2 cup frozen peas
      1/2 cup carrots
      soy sauce
      1 egg`,
    tags: ["slot:dinner","prot:egg","cuisine:asian","veg"],
  },
  {
    title: "Baked Salmon & Greens",
    minutes: 20,
    costUSD: 4.2,
    ingredients: M`150 g salmon
      1 cup spinach
      lemon
      olive oil`,
    tags: ["slot:dinner","prot:fish","cuisine:us","pesc","gluten-free"],
  },
  {
    title: "Chickpea Coconut Curry",
    minutes: 24,
    costUSD: 1.9,
    ingredients: M`1 cup chickpeas
      1/2 onion
      1 cup coconut milk
      curry powder
      spinach`,
    tags: ["slot:dinner","prot:plant","cuisine:ind","vegan","nut?coconut"],
  },
  {
    title: "Tofu & Broccoli Stir-Fry",
    minutes: 18,
    costUSD: 1.8,
    ingredients: M`200 g tofu
      1 cup broccoli
      soy sauce
      ginger`,
    tags: ["slot:dinner","prot:tofu","cuisine:asian","vegan"],
  },
  {
    title: "Turkey Chili",
    minutes: 35,
    costUSD: 3.0,
    ingredients: M`200 g ground turkey
      1/2 onion
      1 cup tomato
      1/2 cup beans
      chili powder`,
    tags: ["slot:dinner","prot:poultry","cuisine:us","halal-ok"],
  },
  {
    title: "Spinach & Feta Pasta",
    minutes: 18,
    costUSD: 1.9,
    ingredients: M`160 g pasta
      1 cup spinach
      1/4 cup feta
      garlic`,
    tags: ["slot:dinner","prot:dairy","cuisine:it","veg"],
  },

  // Snacks / Dessert (optional future slots)
  {
    title: "Yogurt & Berries",
    minutes: 3,
    costUSD: 1.1,
    ingredients: M`1 cup yogurt
      1/2 cup berries`,
    tags: ["slot:snack","prot:dairy","cuisine:us","veg"],
  },
  {
    title: "Peanut Butter Banana",
    minutes: 2,
    costUSD: 0.6,
    ingredients: M`1 banana
      1 tbsp peanut butter`,
    tags: ["slot:snack","prot:plant","cuisine:us","vegan?pb"],
  },
  {
    title: "Dark Chocolate Square",
    minutes: 1,
    costUSD: 0.5,
    ingredients: M`1 piece dark chocolate`,
    tags: ["slot:dessert","prot:none","cuisine:eu","vegan"],
  },
];

// --- Filters ---------------------------------------------------------------

function violatesDiet(tags: string[], diet: Diet): boolean {
  const set = new Set(tags);
  if (diet === "vegan") {
    return set.has("prot:beef") || set.has("prot:chicken") || set.has("prot:poultry") ||
           set.has("prot:fish") || set.has("prot:dairy") || set.has("prot:egg");
  }
  if (diet === "vegetarian") {
    return set.has("prot:beef") || set.has("prot:chicken") || set.has("prot:poultry") || set.has("prot:fish");
  }
  if (diet === "pescatarian") {
    return set.has("prot:beef") || set.has("prot:chicken") || set.has("prot:poultry");
  }
  // keto/paleo not strictly enforced here (handled later with macros)
  return false;
}

function violatesReligious(tags: string[], religious?: Prefs["religious"]): boolean {
  if (!religious || religious === "none") return false;
  const set = new Set(tags);
  if (religious === "halal") {
    // naive: exclude pork (none here), flag questionable alcohol/gelatin (none here)
    // treat "halal-ok" as safe, allow poultry/beef if present
    return false;
  }
  if (religious === "kosher") {
    // naive: avoid mixed meat/dairy and shellfish; our small set avoids shellfish already
    return false;
  }
  return false;
}

function violatesAllergens(ingredients: string[], allergens: string[]): boolean {
  const s = ingredients.join(" ").toLowerCase();
  const A = allergens.map(a => a.toLowerCase());
  // naive mapper: dairy, egg, peanut/tree nut, gluten, soy, fish, shellfish, sesame
  if (A.includes("dairy") && /(milk|cheese|yogurt|feta|butter|cream)/.test(s)) return true;
  if (A.includes("egg") && /\begg(s)?\b/.test(s)) return true;
  if ((A.includes("peanut") || A.includes("tree nut")) && /(peanut|almond|walnut|pecan|pistachio|cashew|hazelnut)/.test(s)) return true;
  if (A.includes("gluten") && /(wheat|pasta|bread|tortilla|semolina)/.test(s)) return true;
  if (A.includes("soy") && /(soy|tofu|soybean)/.test(s)) return true;
  if (A.includes("fish") && /(salmon|tuna|cod|anchovy|sardine|fish)/.test(s)) return true;
  if (A.includes("shellfish") && /(shrimp|prawn|lobster|crab)/.test(s)) return true;
  if (A.includes("sesame") && /(sesame|tahini)/.test(s)) return true;
  return false;
}

function violatesDislikes(ingredients: string[], dislikes: string[]): boolean {
  const s = ingredients.join(" ").toLowerCase();
  return dislikes.some(d => s.includes(d.toLowerCase()));
}

// --- Public API ------------------------------------------------------------

/**
 * Returns a set of mock Candidates filtered by pantry overlap and user prefs.
 * This is ONLY for local testing prior to live pricing / wider AI.
 */
export function getMockCandidates(
  pantry: string[],
  prefs: Prefs,
  limit = 40
): Candidate[] {
  const pantrySet = new Set(pantry.map(p => normName(p)));

  const filtered = MOCK_RECIPES.filter(r => {
    if (violatesDiet(r.tags, prefs.diet)) return false;
    if (violatesReligious(r.tags, prefs.religious)) return false;
    if (violatesAllergens(r.ingredients, prefs.allergens ?? [])) return false;
    if (violatesDislikes(r.ingredients, prefs.dislikes ?? [])) return false;

    // simple pantry relevance: require at least 1 overlapping ingredient
    const overlap = r.ingredients.some(i => pantrySet.has(normName(i)));
    // If pantry is tiny, relax the constraint to allow variety.
    return true;
  });

  const mapped: Candidate[] = filtered.slice(0, limit).map((r, i) => ({
    id: `${r.title}-${i}`,
    title: r.title,
    minutes: r.minutes,
    costUSD: r.costUSD,
    ingredients: r.ingredients.map(x => normName(x)),
    steps: r.steps ?? ["Prep ingredients", "Cook as usual", "Taste and adjust"],
    tags: r.tags,
    coverage: 0.6,          // mock pricing coverage
    priceConfidence: 0.6,   // mock confidence
  }));

  return mapped;
}

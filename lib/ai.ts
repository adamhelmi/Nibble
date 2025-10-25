// lib/ai.ts
import Constants from "expo-constants";
import { ensurePrefsLoaded, getPrefs, type Prefs } from "./prefs";

/** ---------- Types ---------- */
export type AIRecipe = {
  title: string;
  minutes: number;
  ingredients: string[];
  steps: string[];
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** ---------- Config ---------- */
// Read the LAN URL from app.config.js -> extra.EXPO_PUBLIC_LLAMA_URL
export const OLLAMA_URL: string =
  ((Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_LLAMA_URL as string) || "";

const MODEL = "llama3.1:8b";

/** ---------- Utils ---------- */
async function timeoutFetch(input: string, init: RequestInit, ms = 30000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

/** ---------- Health check ---------- */
export async function pingOllama(timeoutMs = 4000): Promise<boolean> {
  if (!OLLAMA_URL) return false;
  try {
    const res = await timeoutFetch(`${OLLAMA_URL}/api/tags`, { method: "GET" }, timeoutMs);
    return res.ok;
  } catch {
    return false;
  }
}

/** ---------- Prefs-aware system header ---------- */
function prefsHeader(p: Prefs): string {
  const chips: string[] = [];
  if (p.diet && p.diet !== "omnivore") chips.push(`diet:${p.diet}`);
  if (p.religious && p.religious !== "none") chips.push(`religious:${p.religious}`);
  if (p.allergens?.length) chips.push(`allergens:${p.allergens.join("|")}`);
  if (p.dislikes?.length) chips.push(`dislikes:${p.dislikes.join("|")}`);

  const rules = [
    `You are Chef Nibble. Be concise and practical. Prioritize user preferences strictly.`,
    `Never propose items that violate diet or religious rules.`,
    `Avoid allergens and disliked items entirely; offer safe substitutions when needed.`,
    `Return short steps and call out potential allergens if uncertain.`,
  ].join(" ");

  const tagLine = chips.length ? `Constraints: ${chips.join(" • ")}.` : `Constraints: none set.`;
  return `${rules} ${tagLine}`;
}

/** =======================================================================
 *  Chef Chat (Ollama /api/chat) — prefs-injected system message
 *  ======================================================================= */
export async function chatOllama(
  messages: ChatMessage[],
  options?: { temperature?: number; num_ctx?: number; stream?: boolean }
): Promise<string> {
  if (!OLLAMA_URL) {
    throw new Error("No Ollama URL set in .env / app.config.js (EXPO_PUBLIC_LLAMA_URL).");
  }

  // Ensure prefs are loaded and inject a system header if caller didn't provide one.
  await ensurePrefsLoaded();
  const prefs = getPrefs();
  const hasSystem = messages.some((m) => m.role === "system");
  const finalMessages: ChatMessage[] = hasSystem
    ? messages
    : [{ role: "system", content: prefsHeader(prefs) }, ...messages];

  const body = {
    model: MODEL,
    messages: finalMessages,
    stream: options?.stream ?? false,
    options: {
      temperature: options?.temperature ?? 0.7,
      num_ctx: options?.num_ctx ?? 4096,
    },
  };

  const res = await timeoutFetch(
    `${OLLAMA_URL}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    30000
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as any;
  const content = data?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Unexpected chat response shape from Ollama.");
  }
  return content;
}

/** =======================================================================
 *  Recipe Suggestions (strict JSON) — /api/generate with format:"json"
 *  ======================================================================= */
export async function aiSuggestRecipes(
  pantry: string[]
): Promise<{ recipes: AIRecipe[]; error?: string }> {
  if (!OLLAMA_URL) return { recipes: [], error: "No Ollama URL set in .env / app.config.js." };

  await ensurePrefsLoaded();
  const p = getPrefs();

  const chips: string[] = [];
  if (p.diet && p.diet !== "omnivore") chips.push(`diet:${p.diet}`);
  if (p.religious && p.religious !== "none") chips.push(`religious:${p.religious}`);
  if (p.allergens?.length) chips.push(`allergens:${p.allergens.join("|")}`);
  if (p.dislikes?.length) chips.push(`dislikes:${p.dislikes.join("|")}`);

  const prompt = `
Return ONLY JSON with this schema:
{"recipes":[{"title":string,"minutes":number,"ingredients":string[],"steps":string[]}]}

Context:
Pantry: ${pantry.length ? pantry.join(", ") : "(none)"}.
Constraints: ${chips.length ? chips.join(" • ") : "none"}.

Requirements:
- 2-3 simple, cheap recipes.
- Respect constraints strictly (no violations).
- "minutes" must be a number.
- Ingredient names should be concise nouns ("onion", "olive oil"), not brand names.
`;

  try {
    const res = await timeoutFetch(
      `${OLLAMA_URL}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          format: "json",
          stream: false,
        }),
      },
      30000
    );

    if (!res.ok) {
      return { recipes: [], error: `Ollama error: ${res.status} ${res.statusText}` };
    }

    const data = (await res.json()) as { response?: string };
    const jsonStr = data?.response ?? "{}";

    let parsed: any = {};
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const m = jsonStr.match(/\{[\s\S]*\}$/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const arr: any[] = Array.isArray(parsed?.recipes) ? parsed.recipes : [];
    const recipes: AIRecipe[] = arr.slice(0, 3).map((r) => ({
      title: String(r?.title ?? "Untitled"),
      minutes: Number.isFinite(r?.minutes) ? Number(r.minutes) : 15,
      ingredients: Array.isArray(r?.ingredients) ? r.ingredients.map(String) : [],
      steps: Array.isArray(r?.steps) ? r.steps.map(String) : [],
    }));

    return { recipes };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Network request timed out" : String(e?.message || e);
    return { recipes: [], error: `Local AI request failed: ${msg}` };
  }
}

/** ---------- Stable aggregate export ---------- */
export const AI = { chatOllama, aiSuggestRecipes, OLLAMA_URL, pingOllama };

console.log("[ai.ts] loaded", {
  chatOllama: typeof chatOllama,
  aiSuggestRecipes: typeof aiSuggestRecipes,
  OLLAMA_URL,
});

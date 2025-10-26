// lib/ai.ts
import Constants from "expo-constants";
import { ensurePrefsLoaded, getPrefs, type Prefs } from "./prefs";

// Day 5 plan sync additions
import { planCapsule, usePlanStore, type PlanCommand } from "./planStore";

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
// Read the URL from app.config.js -> extra.EXPO_PUBLIC_LLAMA_URL (or .env)
export const OLLAMA_URL: string =
  ((Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_LLAMA_URL as string) ||
  (process.env.EXPO_PUBLIC_LLAMA_URL as string) ||
  "";

const MODEL = "llama3.1:8b";

/** ---------- Utils ---------- */
async function timeoutFetch(input: string, init: RequestInit, ms = 30000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    // Attach signal (without mutating the original init object)
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
    `You are Chef Nibble. Be concise and practical.`,
    `Respect the user's diet and religious rules strictly.`,
    `Avoid allergens and dislikes entirely; offer safe substitutions when needed.`,
    `Prefer short steps and point out uncertainty briefly if needed.`,
  ].join(" ");

  const tagLine = chips.length ? `Constraints: ${chips.join(" • ")}.` : `Constraints: none set.`;
  return `${rules} ${tagLine}`;
}

/** ---------- Plan snapshot header (Day 5) ---------- */
function planHeader(): string {
  try {
    return [
      `=== PLAN SNAPSHOT ===`,
      planCapsule(),
      `Instructions:`,
      `- When the user asks to modify the plan, emit a JSON array like:`,
      `  COMMANDS=[{"op":"swap","a":{"day":1,"slot":"dinner"},"b":{"day":4,"slot":"lunch"}}]`,
      `  Supported ops: swap | lock | optimize | fill-gaps`,
      `  lock: {"op":"lock","day":2,"slot":"dinner","locked":true}`,
      `  optimize: {"op":"optimize","target":"cost"|"time","delta":-10}`,
      `  fill-gaps: {"op":"fill-gaps"}`,
      `Then provide a short human summary.`,
      `=====================`,
    ].join("\n");
  } catch {
    return `=== PLAN SNAPSHOT ===\n<unavailable>\n=====================`;
  }
}

/** =======================================================================
 *  Chef Chat (Ollama /api/generate) — prefs + plan snapshot, COMMAND bridge
 *  ======================================================================= */
export async function chatOllama(
  messages: ChatMessage[],
  options?: { temperature?: number; num_ctx?: number; stream?: boolean }
): Promise<string> {
  if (!OLLAMA_URL) {
    throw new Error("No Ollama URL set in .env / app.config.js (EXPO_PUBLIC_LLAMA_URL).");
  }

  await ensurePrefsLoaded();
  const prefs = getPrefs();
  const hasSystem = messages.some((m) => m.role === "system");

  const systemHeader = [
    prefsHeader(prefs),
    planHeader(), // <<< Day 5 addition
  ].join("\n\n");

  // We use /api/generate (prompt) to avoid streaming parse complexity.
  const assembled = `
<system>
${hasSystem ? messages.find((m) => m.role === "system")?.content : systemHeader}
</system>

${messages
  .filter((m) => m.role !== "system")
  .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
  .join("\n")}
ASSISTANT:
`.trim();

  const body = {
    model: MODEL,
    prompt: assembled,
    stream: options?.stream ?? false,
    options: {
      temperature: options?.temperature ?? 0.6,
      num_ctx: options?.num_ctx ?? 4096,
      num_predict: 320,
    },
  };

  const res = await timeoutFetch(
    `${OLLAMA_URL}/api/generate`,
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
  const content = typeof data?.response === "string" ? data.response : "";

  // Try to auto-apply COMMANDS from the model output (Day 5 bridge)
  const m = /COMMANDS\s*=\s*(\[[\s\S]*?\])/i.exec(content);
  if (m) {
    try {
      const cmds = JSON.parse(m[1]) as PlanCommand[];
      // Silent guard: validate basic structure before apply
      const ok = Array.isArray(cmds) && cmds.every((c) => typeof c?.op === "string");
      if (ok) usePlanStore.getState().applyCommands(cmds, "assistant");
    } catch {
      // ignore parse errors; user still gets the textual response
    }
  }

  return content || "I’m here. How do you want to update your plan?";
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
`.trim();

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

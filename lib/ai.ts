// lib/ai.ts
import Constants from "expo-constants";

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
// Example in app.config.js:
// extra: { EXPO_PUBLIC_LLAMA_URL: "http://192.168.1.12:11434" }
export const OLLAMA_URL: string =
  ((Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_LLAMA_URL as string) || "";

const MODEL = "llama3.1:8b";

/** ---------- Utils ---------- */
// Hard timeout wrapper so we never hang forever
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

/** =======================================================================
 *  Chef Chat (Ollama /api/chat) — used by /app/chef-chat.tsx
 *  Returns assistant message content as a single string (non-stream).
 *  ======================================================================= */
export async function chatOllama(
  messages: ChatMessage[],
  options?: { temperature?: number; num_ctx?: number; stream?: boolean }
): Promise<string> {
  if (!OLLAMA_URL) {
    throw new Error("No Ollama URL set in .env / app.config.js (EXPO_PUBLIC_LLAMA_URL).");
  }

  const body = {
    model: MODEL,
    messages,
    stream: options?.stream ?? false, // keep simple for Expo; streaming later
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

  // /api/chat returns { message: { role, content }, ... }
  const data = (await res.json()) as any;
  const content = data?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Unexpected chat response shape from Ollama.");
  }
  return content;
}

/** =======================================================================
 *  Recipe Suggestions (strict JSON) — /api/generate with format:"json"
 *  Keeps current callers working as-is.
 *  ======================================================================= */
export async function aiSuggestRecipes(
  pantry: string[]
): Promise<{ recipes: AIRecipe[]; error?: string }> {
  if (!OLLAMA_URL) return { recipes: [], error: "No Ollama URL set in .env / app.config.js." };

  // Short, deterministic prompt for JSON output
  const prompt = `
Return ONLY JSON with this schema:
{"recipes":[{"title":string,"minutes":number,"ingredients":string[],"steps":string[]}]}

Pantry: ${pantry.length ? pantry.join(", ") : "(none)"}.
Suggest 2-3 simple, cheap recipes. Minutes must be a number.`;

  try {
    const res = await timeoutFetch(
      `${OLLAMA_URL}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          format: "json", // force pure JSON
          stream: false,  // single JSON response
        }),
      },
      30000
    );

    if (!res.ok) {
      return { recipes: [], error: `Ollama error: ${res.status} ${res.statusText}` };
    }

    // /api/generate with stream:false returns: { response: "<json string>", ... }
    const data = (await res.json()) as { response?: string };
    const jsonStr = data?.response ?? "{}";

    let parsed: any = {};
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // last-resort extraction if model wraps text
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

/** ---------- Stable aggregate export (Interop-friendly) ---------- */
export const AI = { chatOllama, aiSuggestRecipes, OLLAMA_URL, pingOllama };

// Optional one-time debug (remove later)
console.log("[ai.ts] loaded", {
  chatOllama: typeof chatOllama,
  aiSuggestRecipes: typeof aiSuggestRecipes,
  OLLAMA_URL,
});

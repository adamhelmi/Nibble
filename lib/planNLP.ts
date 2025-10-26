// lib/planNLP.ts
import { Meal, MealSlot, PlanCommand } from './planStore';

const DAY_INDEX: Record<string, number> = {
  mon:0,monday:0,tue:1,tues:1,tuesday:1,wed:2,weds:2,wednesday:2,thu:3,thur:3,thurs:3,thursday:3,
  fri:4,friday:4,sat:5,saturday:5,sun:6,sunday:6
};

const SLOT_ALIAS: Record<string, MealSlot> = {
  breakfast:'breakfast', brunch:'breakfast', lunch:'lunch', dinner:'dinner', supper:'dinner',
  snack:'snack', dessert:'dessert', sweet:'dessert'
};

function parseDay(s: string): number | null {
  const k = s.toLowerCase();
  return DAY_INDEX[k] ?? null;
}
function parseSlot(s: string): MealSlot | null {
  const k = s.toLowerCase();
  return SLOT_ALIAS[k] ?? null;
}

export type AIReplacementSpec = {
  name?: string;
  tags?: string[];           // e.g., ['vegetarian','pasta']
  costCap?: number;          // USD max
  timeCap?: number;          // minutes max
};

export function parsePlanCommands(text: string): PlanCommand[] {
  const t = text.trim();
  const cmds: PlanCommand[] = [];

  // swap X dinner with Y lunch
  {
    const m = /swap\s+(\w+)\s+(\w+)\s+(?:with|and)\s+(\w+)\s+(\w+)/i.exec(t);
    if (m) {
      const aDay = parseDay(m[1]); const aSlot = parseSlot(m[2]);
      const bDay = parseDay(m[3]); const bSlot = parseSlot(m[4]);
      if (aDay!=null && aSlot && bDay!=null && bSlot) {
        cmds.push({ op:'swap', a:{ day:aDay, slot:aSlot }, b:{ day:bDay, slot:bSlot } });
      }
    }
  }

  // lock/unlock
  {
    const m = /(lock|unlock)\s+(\w+)\s+(\w+)/i.exec(t);
    if (m) {
      const day = parseDay(m[2]); const slot = parseSlot(m[3]);
      if (day!=null && slot) cmds.push({ op:'lock', day, slot, locked: m[1].toLowerCase()==='lock' });
    }
  }

  // optimize cheaper/faster
  {
    const m = /(cheapen|cheaper|reduce cost|increase cost|speed up|slow down|faster|slower|add|remove)\s+(?:by\s*)?(\$?\s*-?\d+)/i.exec(t);
    if (m) {
      const verb = m[1].toLowerCase();
      const raw = m[2].replace(/\s|\$/g,'');
      const val = Number(raw);
      if (!Number.isNaN(val)) {
        if (/(cheapen|cheaper|reduce cost|increase cost)/.test(verb)) {
          const delta = /increase/.test(verb) ? Math.abs(val) : -Math.abs(val);
          cmds.push({ op:'optimize', target:'cost', delta });
        } else {
          const delta = /(slow|slower|add)/.test(verb) ? Math.abs(val) : -Math.abs(val);
          cmds.push({ op:'optimize', target:'time', delta });
        }
      }
    }
  }

  // fill gaps
  if (/fill (?:all )?gaps|fill missing/i.test(t)) {
    cmds.push({ op:'fill-gaps' });
  }

  // replace Monday dinner with vegetarian pasta under $6 in 20 minutes
  {
    const m = /replace\s+(\w+)\s+(\w+)\s+with\s+(.+)/i.exec(t);
    if (m) {
      const day = parseDay(m[1]); const slot = parseSlot(m[2]); const tail = m[3];
      if (day!=null && slot) {
        const tags: string[] = [];
        if (/vegetarian|vegan|pescatarian|halal|kosher/i.test(tail)) tags.push(tail.match(/vegetarian|vegan|pescatarian|halal|kosher/i)![0].toLowerCase());
        if (/pasta|stir[- ]?fry|salad|soup|tacos|wrap|bowl/i.test(tail)) tags.push(tail.match(/pasta|stir[- ]?fry|salad|soup|tacos|wrap|bowl/i)![0].toLowerCase());
        const costCapMatch = /(under|<|<=)\s*\$?\s*(\d+(\.\d+)?)/i.exec(tail);
        const timeCapMatch = /(in|<=)\s*(\d+)\s*(min|minutes)/i.exec(tail);
        const spec: AIReplacementSpec = {
          tags: tags.length ? tags : undefined,
          costCap: costCapMatch ? Number(costCapMatch[2]) : undefined,
          timeCap: timeCapMatch ? Number(timeCapMatch[2]) : undefined,
        };
        // We don't synthesize a Meal here; higher layer should propose one deterministically/AI, then call replace.
        // Emit a placeholder optimize + fill-gaps combo to trigger proposer, UI should handle via assistant.
        cmds.push({ op:'optimize', target: 'cost', delta: 0 }); // noop to signal intent
      }
    }
  }

  return cmds;
}

// Helper to build a simple Meal if the assistant returns raw text fallback
export function mealFromText(slot: MealSlot, name: string, opts?: { costUSD?: number; timeMins?: number; tags?: string[] }): Meal {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    name,
    slot,
    ingredients: [],
    tags: opts?.tags ?? ['protein:veg', 'cuisine:generic'],
    timeMins: opts?.timeMins ?? 15,
    costUSD: opts?.costUSD ?? 4.0,
    source: 'ai',
  };
}

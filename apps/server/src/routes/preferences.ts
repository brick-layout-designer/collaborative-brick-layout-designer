// Account preferences: the appearance and help settings that follow a
// person between browsers and, through an API token, the desktop app.
//
//   GET /api/me/preferences  -> { prefs, updatedAt }
//   PUT /api/me/preferences  { prefs: {...some keys} } -> { prefs, updatedAt }
//
// PUT merges the keys it is given onto what is stored, so two clients
// that each change one setting don't undo each other. Unknown keys and
// wrong types are refused (400) rather than stored. `updatedAt` is null
// until the account saves anything; the desktop compares it with its
// own copy and keeps the newer one.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';

export const THEMES = ['light', 'dark', 'system'] as const;
export const ACCENTS = ['brick', 'ocean', 'forest', 'plum', 'sunny'] as const;
export const MAX_TOURS = 200;
const TOUR_ID = /^[A-Za-z0-9._-]{1,64}$/;

export interface Preferences {
  theme: (typeof THEMES)[number];
  accent: (typeof ACCENTS)[number];
  largeText: boolean;
  expertMode: boolean;
  helpIcons: boolean;
  toursSeen: string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  accent: 'brick',
  largeText: false,
  expertMode: false,
  helpIcons: true,
  toursSeen: [],
};

/**
 * Check a partial preferences object. Returns the cleaned partial, or an
 * error message naming the first bad key.
 */
export function validatePreferences(input: unknown): { ok: Partial<Preferences> } | { error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { error: 'prefs must be an object' };
  }
  const out: Partial<Preferences> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    switch (key) {
      case 'theme':
        if (!(THEMES as readonly unknown[]).includes(value)) return { error: `theme must be one of ${THEMES.join(', ')}` };
        out.theme = value as Preferences['theme'];
        break;
      case 'accent':
        if (!(ACCENTS as readonly unknown[]).includes(value)) return { error: `accent must be one of ${ACCENTS.join(', ')}` };
        out.accent = value as Preferences['accent'];
        break;
      case 'largeText':
      case 'expertMode':
      case 'helpIcons':
        if (typeof value !== 'boolean') return { error: `${key} must be true or false` };
        out[key] = value;
        break;
      case 'toursSeen': {
        if (!Array.isArray(value) || value.length > MAX_TOURS) return { error: `toursSeen must be a list of at most ${MAX_TOURS} ids` };
        if (!value.every((v) => typeof v === 'string' && TOUR_ID.test(v))) return { error: 'toursSeen has an invalid tour id' };
        out.toursSeen = [...new Set(value as string[])];
        break;
      }
      default:
        return { error: `unknown preference: ${key}` };
    }
  }
  return { ok: out };
}

/** Stored JSON back to a full object; anything unreadable falls back to the default. */
function fromStored(raw: string): Preferences {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
  const checked = validatePreferences(parsed);
  return { ...DEFAULT_PREFERENCES, ...('ok' in checked ? checked.ok : {}) };
}

async function load(userId: string): Promise<{ prefs: Preferences; updatedAt: string | null }> {
  const row = await db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).get();
  if (!row) return { prefs: { ...DEFAULT_PREFERENCES }, updatedAt: null };
  return { prefs: fromStored(row.prefs), updatedAt: row.updatedAt.toISOString() };
}

export async function preferencesRoutes(app: FastifyInstance): Promise<void> {
  // Reading is harmless: any token that can read layouts may, as may one
  // granted account:prefs.
  app.get('/api/me/preferences', { config: { apiToken: ['layouts:read', 'account:prefs'] } }, async (req) => {
    const user = requireUser(req);
    return load(user.id);
  });

  app.put<{ Body: { prefs?: unknown } | undefined }>(
    '/api/me/preferences',
    { config: { apiToken: 'account:prefs' } },
    async (req, reply) => {
      const user = requireUser(req);
      const body = req.body;
      if (typeof body !== 'object' || body === null || !('prefs' in body)) {
        return reply.code(400).send({ error: 'prefs is required' });
      }
      const checked = validatePreferences(body.prefs);
      if ('error' in checked) return reply.code(400).send({ error: checked.error });

      const current = await load(user.id);
      const prefs: Preferences = { ...current.prefs, ...checked.ok };
      const updatedAt = new Date();
      const json = JSON.stringify(prefs);
      await db
        .insert(schema.userPreferences)
        .values({ userId: user.id, prefs: json, updatedAt })
        .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { prefs: json, updatedAt } });
      return { prefs, updatedAt: updatedAt.toISOString() };
    },
  );
}

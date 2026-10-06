// Admin › Settings › Privacy: the numbers behind "Download my data" (and,
// later, deleting accounts and keeping records). Stored as one JSON object
// in platform_settings.privacy, like the usage limits. For each setting,
// first match wins:
//   1. its PRIVACY_* env var, when set to a whole number in range: it
//      forces the value, and the settings page says "Forced by …"
//   2. what an admin saved in Admin › Settings
//   3. the built-in default below
// Read live (a short cache, cleared on save), so a change needs no restart.

import { getPlatformSettings } from '../auth/platformSettings.js';

export type PrivacyKey = 'exportEveryHours' | 'exportMaxMb' | 'exportKeepDays';

export interface PrivacySettingInfo {
  key: PrivacyKey;
  label: string;
  /** One plain sentence for the settings page. */
  help: string;
  unit: 'hours' | 'days' | 'mb';
  builtIn: number;
  min: number;
  max: number;
  envVar: string;
}

export const PRIVACY_SETTINGS: readonly PrivacySettingInfo[] = [
  {
    key: 'exportEveryHours',
    label: 'One data download every',
    help: 'How often one person may ask for a download of their data. Building one takes work, so once a day is plenty.',
    unit: 'hours',
    builtIn: 24,
    min: 1,
    max: 720,
    envVar: 'PRIVACY_EXPORT_EVERY_HOURS',
  },
  {
    key: 'exportMaxMb',
    label: 'Biggest data download',
    help: 'A download that would be bigger stops and says so; the person (or you) can ask again after tidying up.',
    unit: 'mb',
    builtIn: 1024,
    min: 10,
    max: 4000,
    envVar: 'PRIVACY_EXPORT_MAX_MB',
  },
  {
    key: 'exportKeepDays',
    label: 'Keep a data download for',
    help: 'After this the download link stops working and the file is deleted from the server.',
    unit: 'days',
    builtIn: 7,
    min: 1,
    max: 30,
    envVar: 'PRIVACY_EXPORT_KEEP_DAYS',
  },
];

const BY_KEY = new Map(PRIVACY_SETTINGS.map((s) => [s.key, s]));

export function isPrivacyKey(k: string): k is PrivacyKey {
  return BY_KEY.has(k as PrivacyKey);
}

function inRange(info: PrivacySettingInfo, v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= info.min && v <= info.max;
}

/** Keep only known keys with whole values in range. */
export function cleanPrivacy(raw: unknown): Partial<Record<PrivacyKey, number>> {
  const out: Partial<Record<PrivacyKey, number>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (isPrivacyKey(k) && inRange(BY_KEY.get(k)!, v)) out[k] = v;
  }
  return out;
}

/** The env var's value when it is a whole number in range, else null. */
export function forcedValue(info: PrivacySettingInfo, source: NodeJS.ProcessEnv = process.env): number | null {
  const raw = source[info.envVar];
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return inRange(info, n) ? n : null;
}

export interface PrivacySettingState extends PrivacySettingInfo {
  /** What applies now. */
  value: number;
  /** What an admin saved (null: the default). Kept even while forced. */
  setting: number | null;
  /** The env var forcing it, or null. */
  forcedBy: string | null;
}

export type PrivacyValues = Record<PrivacyKey, number>;

const CACHE_MS = 30_000;
let cache: { at: number; states: PrivacySettingState[] } | null = null;

export function invalidatePrivacyCache(): void {
  cache = null;
}

function parse(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Every privacy setting with where its value comes from (Admin › Settings). */
export async function privacySettingStates(now: number = Date.now()): Promise<PrivacySettingState[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.states;
  const stored = cleanPrivacy(parse((await getPlatformSettings()).privacy));
  const states = PRIVACY_SETTINGS.map((info) => {
    const forced = forcedValue(info);
    const setting = stored[info.key] ?? null;
    return { ...info, value: forced ?? setting ?? info.builtIn, setting, forcedBy: forced === null ? null : info.envVar };
  });
  cache = { at: now, states };
  return states;
}

/** The values in force now. */
export async function privacySettings(now: number = Date.now()): Promise<PrivacyValues> {
  const out = {} as PrivacyValues;
  for (const s of await privacySettingStates(now)) out[s.key] = s.value;
  return out;
}

/**
 * Merge an admin's patch into what is stored: a number sets a key, null
 * puts it back to the default. Returns the new JSON, or an error naming
 * the first bad key.
 */
export function mergePrivacyPatch(storedJson: string | null, patch: unknown): { json: string } | { error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'invalid_privacy' };
  const next: Record<string, number> = { ...cleanPrivacy(parse(storedJson)) };
  for (const [k, v] of Object.entries(patch)) {
    if (!isPrivacyKey(k)) return { error: `invalid_privacy_key:${k}` };
    if (v === null) delete next[k];
    else if (inRange(BY_KEY.get(k)!, v)) next[k] = v;
    else return { error: `invalid_privacy_value:${k}` };
  }
  return { json: JSON.stringify(next) };
}

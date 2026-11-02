import type { RawIntention } from './intention';
import type { TimeoutMs } from './time';
import { generateUUID, type UUID } from './uuid';

export type InactivityMode = 'off' | 'all-except-audio' | 'all';
export type BreathAnimationIntensity = 'off' | 'minimal' | 'medium' | 'heavy';

export interface Settings {
  intentions: RawIntention[];
  fuzzyMatching: boolean;
  inactivityMode: InactivityMode;
  inactivityTimeoutMs: TimeoutMs;
  showAdvancedSettings: boolean;
  canCopyIntentionText: boolean;
  breathAnimationIntensity: BreathAnimationIntensity;
  directToSettings: boolean;
  debugLogging: boolean;
}

export const defaultSettings: Settings = {
  intentions: [],
  fuzzyMatching: true,
  inactivityMode: 'off',
  inactivityTimeoutMs: (30 * 60 * 1000) as TimeoutMs,
  showAdvancedSettings: false,
  canCopyIntentionText: false,
  breathAnimationIntensity: 'minimal',
  directToSettings: false,
  debugLogging: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasIntentionText = (
  value: unknown
): value is Record<string, unknown> & { url: string; phrase: string } =>
  isRecord(value) &&
  typeof value.url === 'string' &&
  typeof value.phrase === 'string';

// Drafts may have incomplete/empty URLs and phrases. Validate their shape,
// leaving URL matching and the editor's completeness checks to their consumers.
function readIntentions(
  value: unknown,
  regenerateIds: boolean
): RawIntention[] {
  if (!Array.isArray(value) || !value.every(hasIntentionText)) {
    throw new Error('Invalid intentions');
  }
  const ids = new Set<string>();
  return value.map(row => {
    let id =
      !regenerateIds && typeof row.id === 'string' && row.id.length > 0
        ? (row.id as UUID)
        : generateUUID();
    if (ids.has(id)) id = generateUUID();
    ids.add(id);
    return { id, url: row.url, phrase: row.phrase };
  });
}

function validSetting(
  key: Exclude<keyof Settings, 'intentions'>,
  value: unknown
): boolean {
  switch (key) {
    case 'inactivityMode':
      return value === 'off' || value === 'all-except-audio' || value === 'all';
    case 'breathAnimationIntensity':
      return (
        value === 'off' ||
        value === 'minimal' ||
        value === 'medium' ||
        value === 'heavy'
      );
    case 'inactivityTimeoutMs':
      return typeof value === 'number' && Number.isFinite(value) && value > 0;
    default:
      return typeof value === 'boolean';
  }
}

/** Validate the complete patch before any persistence; never copy unknown keys. */
export function parseSettingsPatch(value: unknown): Partial<Settings> {
  if (!isRecord(value)) throw new Error('Invalid settings');
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    if (!Object.hasOwn(value, key)) continue;
    if (key === 'intentions') {
      result.intentions = readIntentions(value.intentions, false);
    } else {
      if (!validSetting(key, value[key]))
        throw new Error(`Invalid setting: ${key}`);
      result[key] = value[key];
    }
  }
  return result as Partial<Settings>;
}

/** Legacy arrays and exported settings both require an explicit intentions list. */
export function parseSettingsImport(
  value: unknown
): Partial<Settings> & Pick<Settings, 'intentions'> {
  const data = Array.isArray(value) ? { intentions: value } : value;
  if (!isRecord(data) || !Object.hasOwn(data, 'intentions')) {
    throw new Error('Missing intentions');
  }
  const patch = parseSettingsPatch(data);
  return { ...patch, intentions: readIntentions(data.intentions, true) };
}

/** Recover old corrupt storage without discarding safe drafts or leaking unknown keys. */
export function readStoredSettings(value: unknown): Settings {
  const result = { ...defaultSettings, intentions: [] as RawIntention[] };
  if (!isRecord(value)) return result;
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    if (!Object.hasOwn(value, key)) continue;
    if (key === 'intentions') {
      if (Array.isArray(value.intentions)) {
        // Reads must not invent scope IDs: background and intention-page
        // consumers need the same identity without performing a repair write.
        const ids = new Set<string>();
        const usable = value.intentions.filter(row => {
          if (
            !hasIntentionText(row) ||
            typeof row.id !== 'string' ||
            row.id.length === 0 ||
            ids.has(row.id)
          )
            return false;
          ids.add(row.id);
          return true;
        });
        result.intentions = readIntentions(usable, false);
      }
    } else if (validSetting(key, value[key])) {
      Object.assign(result, { [key]: value[key] });
    }
  }
  return result;
}

/**
 * What the timeout editor's contents amount to.
 *
 * Returning the default minute count for unusable input made "the user typed
 * nothing" and "the user chose 30 minutes" the same answer, so clearing the
 * box snapped it back to 30 and saved that. The caller has to tell them apart
 * to leave a half-typed field alone.
 */
export type TimeoutMinutesInput =
  | { kind: 'minutes'; minutes: number }
  | { kind: 'no-number' };

/** Parse the timeout editor's whole-minute value. */
export function parseTimeoutMinutesInput(value: string): TimeoutMinutesInput {
  const minutes = Number.parseInt(value, 10);
  if (Number.isNaN(minutes)) return { kind: 'no-number' };
  // Infinity is a number that is merely too big, which clamping answers. It is
  // not an absence, and treating it as one would throw away what was meant.
  return { kind: 'minutes', minutes: Math.min(480, Math.max(1, minutes)) };
}

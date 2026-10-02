export const COMMON_SETTING_KEYS = [
  'mathimg.lang',
  'mathimg.theme',
  'mathimg.historyLimit',
  'mathimg.suggestEnabled',
  'mathimg.defaultTextEnabled',
  'mathimg.defaultFormat',
  'mathimg.defaultFontSizePx',
  'mathimg.defaultScale',
  'mathimg.defaultPaddingPx',
  'mathimg.defaultTransparentBg',
  'mathimg.bracketWrapSelectionEnabled',
  'mathimg.tabSize',
  'mathimg.uiScalePercent',
  'mathimg.tmplScalePercent',
] as const;

const TRANSFERABLE_SETTING_KEYS = new Set<string>([
  ...COMMON_SETTING_KEYS,
  'mathimg.exitSaveMode',
  'mathimg.startupMode',
]);

export interface ParsedSettingsBackup {
  settings: Record<string, string>;
}

interface KeyValueReader {
  getItem(key: string): string | null;
}

function isIntegerInRange(value: string, min: number, max: number): boolean {
  if (!/^-?\d+$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max;
}

function isValidSettingValue(key: string, value: string): boolean {
  switch (key) {
    case 'mathimg.lang':
      return value === 'ja' || value === 'en';
    case 'mathimg.theme':
      return value === 'light' || value === 'dark';
    case 'mathimg.historyLimit':
      return isIntegerInRange(value, 5, 20);
    case 'mathimg.suggestEnabled':
    case 'mathimg.defaultTextEnabled':
    case 'mathimg.defaultTransparentBg':
    case 'mathimg.bracketWrapSelectionEnabled':
      return value === 'on' || value === 'off';
    case 'mathimg.defaultFormat':
      return value === 'svg' || value === 'png';
    case 'mathimg.defaultFontSizePx':
      return isIntegerInRange(value, 12, 200);
    case 'mathimg.defaultScale': {
      const number = Number(value);
      return Number.isFinite(number) && number >= 1 && number <= 8 && Number.isInteger(number * 2);
    }
    case 'mathimg.defaultPaddingPx':
      return isIntegerInRange(value, 0, 200);
    case 'mathimg.tabSize':
      return isIntegerInRange(value, 1, 16);
    case 'mathimg.uiScalePercent':
    case 'mathimg.tmplScalePercent':
      return isIntegerInRange(value, 70, 150);
    case 'mathimg.exitSaveMode':
      return value === 'confirm' || value === 'auto' || value === 'none';
    case 'mathimg.startupMode':
      return value === 'default' || value === 'lastSource';
    default:
      return false;
  }
}

export function createSettingsBackupJson(
  storage: KeyValueReader,
  keys: readonly string[],
  language: string,
  exportedAt = new Date(),
): string {
  const settings: Record<string, string> = {};
  for (const key of keys) {
    if (!TRANSFERABLE_SETTING_KEYS.has(key)) continue;
    const value = key === 'mathimg.lang' ? language : storage.getItem(key);
    if (value !== null && isValidSettingValue(key, value)) settings[key] = value;
  }

  return JSON.stringify(
    {
      format: 'equashare-settings',
      schemaVersion: 1,
      exportedAt: exportedAt.toISOString(),
      settings,
    },
    null,
    2,
  );
}

export function parseSettingsBackupJson(json: string): ParsedSettingsBackup | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const backup = parsed as Record<string, unknown>;
  if (backup.format !== 'equashare-settings' || backup.schemaVersion !== 1) return null;
  if (!backup.settings || typeof backup.settings !== 'object' || Array.isArray(backup.settings)) return null;

  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(backup.settings as Record<string, unknown>)) {
    if (!TRANSFERABLE_SETTING_KEYS.has(key)) continue;
    if (typeof value !== 'string' || !isValidSettingValue(key, value)) return null;
    settings[key] = value;
  }

  return Object.keys(settings).length > 0 ? { settings } : null;
}

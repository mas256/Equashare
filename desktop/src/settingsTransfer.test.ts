import { describe, expect, it } from 'vitest';
import { createSettingsBackupJson, parseSettingsBackupJson } from '../../shared/settingsTransfer';

describe('settings JSON transfer', () => {
  it('exports only supported preferences and includes the active language', () => {
    const values: Record<string, string> = {
      'mathimg.theme': 'light',
      'mathimg.homeDir': 'C:\\private',
    };
    const storage = {
      getItem: (key: string) => values[key] ?? null,
    };

    const json = createSettingsBackupJson(
      storage,
      ['mathimg.lang', 'mathimg.theme', 'mathimg.homeDir'],
      'en',
      new Date('2026-10-02T00:00:00.000Z'),
    );

    expect(JSON.parse(json)).toEqual({
      format: 'equashare-settings',
      schemaVersion: 1,
      exportedAt: '2026-10-02T00:00:00.000Z',
      settings: {
        'mathimg.lang': 'en',
        'mathimg.theme': 'light',
      },
    });
  });

  it('accepts valid settings, ignores unknown future keys, and rejects invalid known values', () => {
    const valid = JSON.stringify({
      format: 'equashare-settings',
      schemaVersion: 1,
      exportedAt: '2026-10-02T00:00:00.000Z',
      settings: {
        'mathimg.defaultScale': '2.5',
        'mathimg.futureSetting': 'ignored',
      },
    });
    expect(parseSettingsBackupJson(valid)?.settings).toEqual({ 'mathimg.defaultScale': '2.5' });

    const invalid = valid.replace('"2.5"', '"2.3"');
    expect(parseSettingsBackupJson(invalid)).toBeNull();
    expect(parseSettingsBackupJson('{"format":"equashare-settings","schemaVersion":99,"settings":{}}')).toBeNull();
  });
});

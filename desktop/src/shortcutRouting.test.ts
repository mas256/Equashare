import { describe, expect, it } from 'vitest';
import { shouldRegisterDesktopShortcut } from './shortcutRouting';

describe('quick popup shortcut routing', () => {
  it('leaves a focused connected browser to the extension', () => {
    expect(shouldRegisterDesktopShortcut(true, true, true)).toBe(false);
  });
  it('registers the desktop shortcut outside the browser', () => {
    expect(shouldRegisterDesktopShortcut(true, false, true)).toBe(true);
  });
  it('keeps the desktop shortcut when browser integration is disabled', () => {
    expect(shouldRegisterDesktopShortcut(true, true, false)).toBe(true);
  });
  it("respects the user's shortcut switch", () => {
    expect(shouldRegisterDesktopShortcut(false, false, true)).toBe(false);
  });
});

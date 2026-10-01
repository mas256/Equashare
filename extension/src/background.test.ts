import { expect, it, vi } from 'vitest';
import { sendSourceToDesktopApp } from './nativeHost';

vi.mock('./nativeHost', () => ({ sendSourceToDesktopApp: vi.fn().mockResolvedValue(true) }));

it('sends a selection found in a child frame to the desktop quick view', async () => {
  let onCommand: ((command: string) => void) | undefined;
  const executeScript = vi.fn().mockResolvedValue([
    { frameId: 0, result: '' },
    { frameId: 2, result: '\\frac{a}{b}' },
  ]);
  const setPopup = vi.fn();
  vi.stubGlobal('chrome', {
    action: { onClicked: { addListener: vi.fn() }, setPopup, openPopup: vi.fn() },
    commands: { onCommand: { addListener: (listener: (command: string) => void) => { onCommand = listener; } } },
    contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    runtime: { onInstalled: { addListener: vi.fn() } },
    scripting: { executeScript },
    storage: { session: { set: vi.fn() } },
    tabs: { query: vi.fn().mockResolvedValue([{ id: 7 }]) },
  });
  await import('./background');

  onCommand?.('open-quick-popup');
  await vi.waitFor(() => expect(sendSourceToDesktopApp).toHaveBeenCalledWith('\\frac{a}{b}'));
  expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
    target: { tabId: 7, allFrames: true },
    world: 'MAIN',
  }));
  expect(setPopup).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

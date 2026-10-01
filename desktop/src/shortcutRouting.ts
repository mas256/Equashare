/** Browser commands own the shortcut while a connected browser is foreground. */
export function shouldRegisterDesktopShortcut(enabled: boolean, browserForeground: boolean, nativeMessagingEnabled: boolean): boolean {
  return enabled && !(browserForeground && nativeMessagingEnabled);
}

// The phone app's native side (G6), only inside Capacitor: the status bar stays out of the way and
// Android's back button pauses, closes a card or leaves the app. Importing the plugins registers
// them, which is also what lets Sound's haptics find Capacitor's Haptics.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import '@capacitor/haptics';
import { StatusBar } from '@capacitor/status-bar';

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** `onBack` returns false when there's nothing left to go back from (the main menu): the app minimizes. */
export function setupNative(o: { onBack(): boolean }): void {
  if (!isNativeApp()) return;
  void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  void StatusBar.hide().catch(() => {});
  void App.addListener('backButton', () => { if (!o.onBack()) void App.minimizeApp(); });
}

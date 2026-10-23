// The phone app's native side (G6), only inside Capacitor: the status bar stays out of the way,
// Android's back button pauses, closes a card or leaves the app, and the launch screen gives way to the
// game's splash. Importing the plugins registers them, which is also what lets Sound's haptics find
// Capacitor's Haptics.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import '@capacitor/haptics';
import { StatusBar } from '@capacitor/status-bar';
import type { GameServicesApi } from './meta/stores.ts';

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** `onBack` returns false when there's nothing left to go back from (the main menu): the app minimizes. */
export function setupNative(o: { onBack(): boolean }): void {
  if (!isNativeApp()) return;
  void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  void StatusBar.hide().catch(() => {});
  void App.addListener('backButton', () => { if (!o.onBack()) void App.minimizeApp(); });
}

/** The app's own plugin (android/.../LaunchSplashPlugin.java). */
const LaunchSplash = registerPlugin<{ hide(): Promise<void> }>('LaunchSplash');
let launchShown = true;

/** The web splash has painted over the launch screen (the same picture), so the launch screen can go. */
export function hideLaunchSplash(): void {
  if (!launchShown || !isNativeApp()) return;
  launchShown = false;
  void LaunchSplash.hide().catch(() => {});
}

/** Play Games (Android) or Game Center (iOS): plugins/game-services. Null on the game page. */
export function gameServices(): GameServicesApi | null {
  return isNativeApp() && Capacitor.isPluginAvailable('GameServices') ? registerPlugin<GameServicesApi>('GameServices') : null;
}

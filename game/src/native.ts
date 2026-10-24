// The phone app's native side (G6), only inside Capacitor: the status bar stays out of the way,
// Android's back button pauses, closes a card or leaves the app, and the launch screen gives way to the
// game's splash. Importing the plugins registers them, which is also what lets Sound's haptics find
// Capacitor's Haptics. Also the phone's share sheet and the store's rating card (launch marketing plan).

import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import '@capacitor/haptics';
import { InAppReview } from '@capacitor-community/in-app-review';
import { Share } from '@capacitor/share';
import { StatusBar } from '@capacitor/status-bar';
import type { GameServicesApi } from './meta/stores.ts';

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** 'android' or 'ios' in the phone apps, 'web' elsewhere. */
export const nativePlatform = (): 'android' | 'ios' | 'web' => {
  const p = Capacitor.getPlatform();
  return p === 'android' || p === 'ios' ? p : 'web';
};

/**
 * The phone's share sheet with the card and its text: the picture goes through a file in the app's cache
 * (the share sheet only takes files). Resolves false when the player backed out of it.
 */
export async function nativeShare(text: string, pngBase64: string): Promise<boolean> {
  const { uri } = await Filesystem.writeFile({ path: 'shape-tower-share.png', data: pngBase64, directory: Directory.Cache });
  try {
    await Share.share({ text, files: [uri], dialogTitle: 'Share your tower' });
    return true;
  } catch (e) {
    if (/cancel/i.test(String((e as Error)?.message ?? e))) return false;
    throw e;
  }
}

/** Asks Google Play or the App Store for its rating card; the store decides whether it shows. */
export function requestReview(): Promise<void> {
  return isNativeApp() ? InAppReview.requestReview().catch(() => {}) : Promise.resolve();
}

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

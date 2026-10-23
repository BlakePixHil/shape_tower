// The ad network (monetisation plan v2, "Ads between runs"): Google AdMob through
// @capacitor-community/admob, in the store apps only. Web builds (the game page, the Wobble Lab) never
// load it. Every request is non-personalised and capped at a G rating, the app drops Android's
// advertising-ID permission, and the only format is an interstitial. Google's consent form (UMP)
// shows once where the law asks for it, never in a run. Until Blake's AdMob account exists, builds
// use Google's published test ids, which only ever serve test ads.

import { Capacitor } from '@capacitor/core';
import { AdMob, AdmobConsentStatus, InterstitialAdPluginEvents, MaxAdContentRating } from '@capacitor-community/admob';

/** Google's test interstitial unit (developers.google.com/admob/android/test-ads). */
const TEST_INTERSTITIAL = { android: 'ca-app-pub-3940256099942544/1033173712', ios: 'ca-app-pub-3940256099942544/4411468910' };

export interface AdNetwork {
  /** Whether this build can show ads at all. */
  readonly live: boolean;
  /** Loads an interstitial in the background, if one isn't loaded yet and consent() has allowed it. Never throws. */
  prepare(): void;
  /** Shows the loaded interstitial; resolves once it's closed. False when none was ready (nothing showed). */
  show(): Promise<boolean>;
  /** Asks for consent where the law requires it (Google's form, once). Resolves whether ads may be requested. */
  consent(): Promise<boolean>;
}

/** Web builds: no ads, ever. */
export const NO_ADS: AdNetwork = { live: false, prepare() {}, show: async () => false, consent: async () => false };

class AdMobNetwork implements AdNetwork {
  readonly live = true;
  private started: Promise<boolean> | null = null;
  private loaded = false;
  private loading = false;
  private allowed: boolean | null = null;

  constructor(private unit: string, private testing: boolean) {}

  private init(): Promise<boolean> {
    this.started ??= AdMob.initialize({ maxAdContentRating: MaxAdContentRating.General, initializeForTesting: this.testing })
      .then(() => true, e => { console.warn('ads: initialize failed', e); return false; });
    return this.started;
  }

  async consent(): Promise<boolean> {
    if (this.allowed !== null) return this.allowed;
    if (!(await this.init())) return false;
    try {
      let info = await AdMob.requestConsentInfo();
      if (info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) info = await AdMob.showConsentForm();
      this.allowed = info.canRequestAds;
    } catch (e) {
      // No consent message set up yet (or offline): outside the EEA and UK ads can still be asked for.
      console.warn('ads: consent', e);
      this.allowed = true;
    }
    return this.allowed;
  }

  prepare(): void {
    // Consent is asked on the menu (consent()), never here: this runs at a run's end.
    if (this.loaded || this.loading || this.allowed !== true) return;
    this.loading = true;
    void (async () => {
      try {
        await AdMob.prepareInterstitial({ adId: this.unit, isTesting: this.testing, npa: true, immersiveMode: true });
        this.loaded = true;
      } catch (e) {
        console.warn('ads: no ad loaded', e); // offline or no fill: nothing shows, and the ad stays due
      } finally {
        this.loading = false;
      }
    })();
  }

  async show(): Promise<boolean> {
    if (!this.loaded) return false;
    this.loaded = false;
    return new Promise<boolean>(resolve => {
      const handles: Promise<{ remove(): Promise<void> }>[] = [];
      const done = (shown: boolean) => { for (const h of handles) void h.then(x => x.remove()).catch(() => {}); resolve(shown); };
      handles.push(AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => done(true)));
      handles.push(AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => done(false)));
      AdMob.showInterstitial().catch(() => done(false));
    });
  }
}

/**
 * The build's ad network: AdMob in the store apps, none on the web. `__ADMOB__` (vite.config.ts, from
 * ST_ADMOB_INTERSTITIAL) is the real interstitial unit once Blake's AdMob exists; without it the
 * test unit loads Google's test ads.
 */
export function adNetwork(): AdNetwork {
  if (!Capacitor.isNativePlatform()) return NO_ADS;
  const real = typeof __ADMOB__ === 'string' ? __ADMOB__ : '';
  const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  return new AdMobNetwork(real || TEST_INTERSTITIAL[platform], !real);
}

declare const __ADMOB__: string | undefined;

import { useEffect, useState } from 'preact/hooks';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chromium fires this once, early, when the app is installable. Hold on to it
// so the guide can offer a real Install button.
let deferred: BeforeInstallPromptEvent | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  notify();
});
addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return deferred;
}

/** Shows the browser's own install dialog. Resolves true if the player accepted. */
export async function promptInstall() {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  notify();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

const SEEN_KEY = 'poly.installGuideSeen';
export function guideSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
export function markGuideSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Not remembered; the guide shows again next visit.
  }
}

export type Platform =
  | 'ios-safari'
  | 'ios-other'
  | 'android-chrome'
  | 'android-samsung'
  | 'android-firefox'
  | 'desktop-chromium'
  | 'mac-safari'
  | 'desktop-firefox'
  | 'other';

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  const iPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPad) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/.test(ua)) {
    if (/SamsungBrowser/.test(ua)) return 'android-samsung';
    if (/Firefox/.test(ua)) return 'android-firefox';
    return 'android-chrome';
  }
  if (/Firefox/.test(ua)) return 'desktop-firefox';
  if (/Edg\/|Chrome\//.test(ua)) return 'desktop-chromium';
  if (/Macintosh/.test(ua) && /Safari/.test(ua)) return 'mac-safari';
  return 'other';
}

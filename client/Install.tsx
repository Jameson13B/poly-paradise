import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { detectPlatform, promptInstall, useInstallPrompt, type Platform } from './install.ts';
import { invite } from './net.ts';

// Small drawings of the browser buttons players are told to look for.
const ShareIcon = () => (
  <svg class="ui-icon" viewBox="0 0 24 24" aria-label="Share">
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1" />
  </svg>
);
const AddIcon = () => (
  <svg class="ui-icon" viewBox="0 0 24 24" aria-label="Add">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
const MenuDots = () => (
  <svg class="ui-icon" viewBox="0 0 24 24" aria-label="Menu">
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="19" r="1.6" />
  </svg>
);
const MenuLines = () => (
  <svg class="ui-icon" viewBox="0 0 24 24" aria-label="Menu">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
const InstallIcon = () => (
  <svg class="ui-icon" viewBox="0 0 24 24" aria-label="Install">
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M12 8v6M9 11l3 3 3-3M8 21h8" />
  </svg>
);

interface Guide {
  device: string;
  steps: ComponentChildren[];
  note?: ComponentChildren;
  /** Chromium browsers can show their own install dialog from a button. */
  prompt?: boolean;
  unsupported?: boolean;
}

const OPEN_FROM_HOME = 'Open Poly Paradise from your Home Screen.';

const GUIDES: Record<Platform, Guide> = {
  'ios-safari': {
    device: 'iPhone or iPad · Safari',
    steps: [
      <>
        Tap the Share button <ShareIcon /> (bottom of the screen on iPhone, top on iPad).
      </>,
      <>
        Scroll down and tap <b>Add to Home Screen</b> <AddIcon />.
      </>,
      <>
        Tap <b>Add</b>, then open Poly Paradise from your Home Screen.
      </>,
    ],
    note: "The Home Screen app keeps its own sign-in on iPhone, so you'll sign in there once. Your account and stats come with you.",
  },
  'ios-other': {
    device: 'iPhone or iPad',
    steps: [
      <>
        Tap the Share button <ShareIcon /> (in Chrome it's in the address bar).
      </>,
      <>
        Tap <b>Add to Home Screen</b> <AddIcon />.
      </>,
      OPEN_FROM_HOME,
    ],
    note: "Don't see Add to Home Screen? Open this page in Safari and try again.",
  },
  'android-chrome': {
    device: 'Android · Chrome',
    prompt: true,
    steps: [
      <>
        Tap the menu <MenuDots /> in the top corner.
      </>,
      <>
        Tap <b>Install app</b> or <b>Add to Home screen</b>.
      </>,
      'Open Poly Paradise from your home screen or app drawer.',
    ],
  },
  'android-samsung': {
    device: 'Android · Samsung Internet',
    prompt: true,
    steps: [
      <>
        Tap the install icon <InstallIcon /> in the address bar, or the menu <MenuLines /> at the bottom.
      </>,
      <>
        Choose <b>Add page to</b> → <b>Home screen</b>.
      </>,
      'Open Poly Paradise from your home screen.',
    ],
  },
  'android-firefox': {
    device: 'Android · Firefox',
    steps: [
      <>
        Tap the menu <MenuDots />.
      </>,
      <>
        Tap <b>Install</b> or <b>Add to Home screen</b>.
      </>,
      'Open Poly Paradise from your home screen.',
    ],
  },
  'desktop-chromium': {
    device: 'Computer · Chrome or Edge',
    prompt: true,
    steps: [
      <>
        Click the install icon <InstallIcon /> at the right end of the address bar.
      </>,
      <>
        Or open the menu <MenuDots /> and choose <b>Install Poly Paradise</b>.
      </>,
    ],
  },
  'mac-safari': {
    device: 'Mac · Safari',
    steps: [
      <>
        In the menu bar, choose <b>File</b> → <b>Add to Dock</b>.
      </>,
      'Open Poly Paradise from your Dock.',
    ],
    note: 'Needs macOS Sonoma or later.',
  },
  'desktop-firefox': {
    device: 'Computer · Firefox',
    unsupported: true,
    steps: [],
    note: "Firefox on desktop can't install web apps. Chrome, Edge or Safari can, or keep playing right here.",
  },
  other: {
    device: 'Your browser',
    steps: [
      <>
        Look in your browser's menu for <b>Install</b> or <b>Add to Home Screen</b>.
      </>,
      'Open Poly Paradise from your home screen.',
    ],
  },
};

export function InstallGuide({ onDone }: { onDone: () => void }) {
  const [platform, setPlatform] = useState(detectPlatform);
  const [picking, setPicking] = useState(false);
  const deferred = useInstallPrompt();
  const guide = GUIDES[platform];
  const code = invite();

  return (
    <div class="gate">
      <h1 class="wordmark">
        <span>Poly</span> Paradise
      </h1>
      {code && (
        <p class="invite-banner facet">
          You're invited to table <b class="mono">{code}</b>. We'll seat you as soon as you're in.
        </p>
      )}

      <div class="panel facet install">
        <p class="eyebrow">Best as an app</p>
        <h2>Put the island on your home screen</h2>
        <p class="muted">Full screen, no browser bars, and one tap from your home screen when someone says "rematch".</p>

        {!isSecureContext && (
          <p class="hint">Installing needs a secure (https) address. You're on a local test address, so your browser won't offer it here.</p>
        )}

        {guide.prompt && deferred && (
          <button class="btn big" onClick={() => promptInstall().then((ok) => ok && onDone())}>
            Install Poly Paradise
          </button>
        )}

        <div class="device-line">
          <span class="badge">{guide.device}</span>
          <button class="link" onClick={() => setPicking(!picking)}>
            Not your device?
          </button>
        </div>
        {picking && (
          <div class="device-pick">
            {(Object.keys(GUIDES) as Platform[]).map((p) => (
              <button
                class={p === platform ? 'on' : ''}
                onClick={() => {
                  setPlatform(p);
                  setPicking(false);
                }}
              >
                {GUIDES[p].device}
              </button>
            ))}
          </div>
        )}

        {guide.steps.length > 0 && (
          <ol class="steps">
            {guide.steps.map((s, i) => (
              <li>
                <span class="step-num facet">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        )}
        {guide.note && <p class="muted small">{guide.note}</p>}
      </div>

      <button class="btn ghost" onClick={onDone}>
        {guide.unsupported ? 'Continue' : 'Continue in the browser'}
      </button>
    </div>
  );
}

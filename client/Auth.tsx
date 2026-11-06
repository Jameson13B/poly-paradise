import { useState } from 'preact/hooks';
import { authenticate, invite } from './net.ts';

type Mode = 'signup' | 'login' | 'link';

export function Auth() {
  const [mode, setMode] = useState<Mode>('signup');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const table = invite();

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const err = await authenticate(mode, mode === 'link' ? { code } : { name, password });
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div class="gate">
      <h1 class="wordmark">
        <span>Poly</span> Paradise
      </h1>
      {table && (
        <p class="invite-banner facet">
          You're invited to table <b class="mono">{table}</b>. Sign in and we'll seat you.
        </p>
      )}

      <form class="panel facet auth" onSubmit={submit}>
        <div class="segmented" role="tablist">
          {(
            [
              ['signup', 'New here'],
              ['login', 'Sign in'],
              ['link', 'Use a code'],
            ] as const
          ).map(([m, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={mode === m}
              class={mode === m ? 'on' : ''}
              onClick={() => {
                setMode(m);
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'link' ? (
          <>
            <p class="muted">
              On a device where you're already signed in, open <b>You</b> → <b>Link a device</b> and enter the code it shows.
            </p>
            <label class="field-label" for="code">
              Link code
            </label>
            <input
              id="code"
              class="field mono code-field"
              value={code}
              maxLength={6}
              autocomplete="one-time-code"
              autocapitalize="characters"
              spellcheck={false}
              onInput={(e) => setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </>
        ) : (
          <>
            <p class="muted">
              {mode === 'signup'
                ? 'Pick the name everyone will see. Your account keeps your stats on any device.'
                : 'Welcome back. Your stats are waiting.'}
            </p>
            <label class="field-label" for="name">
              Player name
            </label>
            <input
              id="name"
              name="username"
              class="field"
              value={name}
              maxLength={20}
              autocomplete="username"
              autocapitalize="words"
              spellcheck={false}
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <label class="field-label" for="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              class="field"
              value={password}
              minLength={mode === 'signup' ? 8 : undefined}
              autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
            {mode === 'signup' && <p class="muted small">At least 8 characters. Your password manager can remember it.</p>}
          </>
        )}

        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
        <button class="btn big" disabled={busy || (mode === 'link' ? code.length !== 6 : !name.trim() || !password)}>
          {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Sign in' : 'Link this device'}
        </button>
      </form>
    </div>
  );
}

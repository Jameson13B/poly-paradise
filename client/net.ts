import { useEffect, useState } from 'preact/hooks';
import type { BoardRow, ClientMsg, Profile, Pulse, RoomView, ServerMsg } from '../shared/protocol.ts';

export interface NetState {
  /** Whether this device holds a session token. */
  signedIn: boolean;
  link: 'connecting' | 'online' | 'offline';
  me: Profile | null;
  room: RoomView | null;
  pulse: Pulse | null;
  boards: Record<string, BoardRow[]>;
  linkCode: { code: string; expires: number } | null;
  error: string | null;
}

const TOKEN_KEY = 'poly.session';
let memoryToken = '';

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

function setToken(token: string | null) {
  memoryToken = token ?? '';
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the in-memory token lasts for this visit.
  }
}

const signedOut = { me: null, room: null, pulse: null, linkCode: null, link: 'connecting' } as const;
let state: NetState = { ...signedOut, signedIn: !!getToken(), boards: {}, error: null };
const subs = new Set<() => void>();

function set(patch: Partial<NetState>) {
  state = { ...state, ...patch };
  for (const f of subs) f();
}

export function useNet() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return state;
}

// Invite links look like /j/BCDF (that's what the QR code holds). The code is
// held through install and sign-up, then used once we're connected.
let pendingJoin = location.pathname.match(/^\/j\/([a-z]{4})$/i)?.[1].toUpperCase() ?? null;
if (pendingJoin) history.replaceState(null, '', '/');
export const invite = () => pendingJoin;

let ws: WebSocket | null = null;
let retries = 0;
let errorTimer = 0;

function raw(m: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function disconnect() {
  const sock = ws;
  ws = null;
  sock?.close();
}

function receive(m: ServerMsg) {
  switch (m.t) {
    case 'me':
      set({ me: m.me, link: 'online' });
      if (pendingJoin) {
        raw({ t: 'join', code: pendingJoin });
        pendingJoin = null;
      }
      break;
    case 'room':
      set({ room: m.room });
      break;
    case 'pulse':
      set({ pulse: m.pulse });
      break;
    case 'board':
      set({ boards: { ...state.boards, [m.game]: m.rows } });
      break;
    case 'linkCode':
      set({ linkCode: { code: m.code, expires: m.expires } });
      break;
    case 'signedOut':
      setToken(null);
      disconnect();
      set({ ...signedOut, signedIn: false });
      break;
    case 'error':
      showError(m.message);
      break;
  }
}

function showError(message: string) {
  clearTimeout(errorTimer);
  set({ error: message });
  errorTimer = window.setTimeout(() => set({ error: null }), 3500);
}

export function connect() {
  if (!getToken() || ws) return;
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => {
    retries = 0;
    raw({ t: 'hello', token: getToken() });
  };
  sock.onmessage = (e) => receive(JSON.parse(e.data));
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    set({ link: 'offline' });
    setTimeout(connect, Math.min(8000, 400 * 2 ** retries++));
  };
}

/** Sign up, sign in, or redeem a link code. Resolves to an error message, or null on success. */
export async function authenticate(kind: 'signup' | 'login' | 'link', body: Record<string, string>): Promise<string | null> {
  const res = await fetch(`/api/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return "Couldn't reach the island. Check your connection.";
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) return data.error ?? 'Something went wrong';
  setToken(data.token);
  set({ signedIn: true });
  connect();
  return null;
}

export function signOut() {
  const token = getToken();
  setToken(null);
  disconnect();
  set({ ...signedOut, signedIn: false });
  fetch('/api/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
}

export const send = raw;

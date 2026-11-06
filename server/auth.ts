import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as db from './db.ts';

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`;
}

async function checkPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  const key = await derive(password, Buffer.from(salt, 'hex'));
  const want = Buffer.from(hash, 'hex');
  return key.length === want.length && timingSafeEqual(key, want);
}

/** Player names double as the sign-in name, so they're unique and kept simple. */
export function cleanName(raw: unknown): string | null {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return /^[\p{L}\p{N} _.-]{3,20}$/u.test(name) ? name : null;
}
export const NAME_RULES = 'Names are 3–20 letters or numbers (spaces, - _ and . are fine too)';

// Link codes let a signed-in device hand its account to another device or to
// the installed app, which on iOS doesn't share storage with Safari.
const LINK_CHARS = 'BCDFGHJKLMNPQRSTVWXZ23456789';
const LINK_TTL = 5 * 60_000;
const links = new Map<string, { playerId: string; expires: number }>();

export function newLinkCode(playerId: string) {
  const now = Date.now();
  for (const [code, l] of links) if (l.expires < now || l.playerId === playerId) links.delete(code);
  let code;
  do code = Array.from({ length: 6 }, () => LINK_CHARS[randomInt(LINK_CHARS.length)]).join('');
  while (links.has(code));
  const expires = now + LINK_TTL;
  links.set(code, { playerId, expires });
  return { code, expires };
}

function redeemLinkCode(raw: unknown) {
  const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const link = links.get(code);
  links.delete(code);
  return link && link.expires > Date.now() ? link.playerId : null;
}

// Failed attempts per address. A whole party can share one public IP, so only failures count.
const failures = new Map<string, { n: number; reset: number }>();
const MAX_FAILURES = 20;

function clientIp(req: IncomingMessage) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || req.socket.remoteAddress || '?';
}

function fail(ip: string) {
  const now = Date.now();
  const f = failures.get(ip);
  if (!f || f.reset < now) failures.set(ip, { n: 1, reset: now + 15 * 60_000 });
  else f.n++;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error('too large');
  }
  const parsed = JSON.parse(body || '{}');
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function reply(res: ServerResponse, status: number, data?: object) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(data ? JSON.stringify(data) : undefined);
}

export async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'POST only' });
  const ip = clientIp(req);
  const f = failures.get(ip);
  if (f && f.reset > Date.now() && f.n >= MAX_FAILURES) return reply(res, 429, { error: 'Too many tries. Take a breather and try again in a few minutes.' });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return reply(res, 400, { error: 'Bad request' });
  }
  const password = typeof body.password === 'string' ? body.password : '';

  switch (path) {
    case '/api/signup': {
      const name = cleanName(body.name);
      if (!name) return reply(res, 400, { error: NAME_RULES });
      if (password.length < 8 || password.length > 200) return reply(res, 400, { error: 'Use a password of at least 8 characters' });
      const player = db.createPlayer(name, await hashPassword(password));
      if (!player) return reply(res, 409, { error: 'That name is taken' });
      return reply(res, 200, { token: db.createSession(player.id) });
    }

    case '/api/login': {
      const creds = db.credentials(String(body.name ?? '').replace(/\s+/g, ' ').trim());
      if (!creds || !(await checkPassword(password, creds.pass_hash))) {
        fail(ip);
        return reply(res, 401, { error: 'Wrong name or password' });
      }
      return reply(res, 200, { token: db.createSession(creds.id) });
    }

    case '/api/link': {
      const playerId = redeemLinkCode(body.code);
      if (!playerId) {
        fail(ip);
        return reply(res, 400, { error: "That code didn't work. Codes last 5 minutes and work once." });
      }
      return reply(res, 200, { token: db.createSession(playerId) });
    }

    case '/api/logout': {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      if (token) db.endSession(token);
      return reply(res, 204);
    }
  }
  reply(res, 404, { error: 'Not found' });
}

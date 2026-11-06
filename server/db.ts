import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BoardRow, GameStat, PlayerPublic, Profile, RecentMatch } from '../shared/protocol.ts';

const path = process.env.DB_PATH ?? 'data/poly.db';
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    seed INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    player_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ratings (
    player_id TEXT NOT NULL,
    game TEXT NOT NULL,
    rating REAL NOT NULL DEFAULT 1000,
    played INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, game)
  );
  CREATE INDEX IF NOT EXISTS ratings_board ON ratings (game, rating DESC);
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    ended_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_players (
    match_id INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    seat INTEGER NOT NULL,
    won INTEGER NOT NULL,
    PRIMARY KEY (match_id, seat)
  );
`);

type Row<T> = T | undefined;
const as = <T>(v: unknown) => v as T;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const isUnique = (err: unknown) => String(err).includes('UNIQUE');

/** Returns null when the name is already taken. */
export function createPlayer(name: string, passHash: string): PlayerPublic | null {
  const p = { id: randomUUID(), name, seed: randomInt(2 ** 31) };
  try {
    db.prepare('INSERT INTO players (id, name, pass_hash, seed, created_at) VALUES (?, ?, ?, ?, ?)').run(p.id, name, passHash, p.seed, Date.now());
  } catch (err) {
    if (isUnique(err)) return null;
    throw err;
  }
  return p;
}

/** Names match case-insensitively. */
export function credentials(name: string) {
  return as<Row<{ id: string; pass_hash: string }>>(db.prepare('SELECT id, pass_hash FROM players WHERE name = ?').get(name));
}

/** Sessions stay signed in until signed out. Only a hash of the token is stored. */
export function createSession(playerId: string): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, player_id, created_at, seen_at) VALUES (?, ?, ?, ?)').run(hash(token), playerId, now, now);
  return token;
}

export function sessionPlayer(token: string): PlayerPublic | null {
  const h = hash(token);
  const p = as<Row<PlayerPublic>>(
    db.prepare('SELECT p.id, p.name, p.seed FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?').get(h),
  );
  if (!p) return null;
  db.prepare('UPDATE sessions SET seen_at = ? WHERE token_hash = ?').run(Date.now(), h);
  return { id: p.id, name: p.name, seed: p.seed };
}

export function endSession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
}

/** Returns false when the name is already taken. */
export function rename(id: string, name: string): boolean {
  try {
    db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, id);
    return true;
  } catch (err) {
    if (isUnique(err)) return false;
    throw err;
  }
}

export function profile(id: string): Profile | null {
  const p = as<Row<PlayerPublic & { created_at: number }>>(db.prepare('SELECT id, name, seed, created_at FROM players WHERE id = ?').get(id));
  if (!p) return null;
  const stats = as<GameStat[]>(
    db.prepare('SELECT game, rating, played, wins FROM ratings WHERE player_id = ? ORDER BY played DESC').all(id),
  ).map((s) => ({ ...s, rating: Math.round(s.rating) }));
  return { id: p.id, name: p.name, seed: p.seed, joined: p.created_at, stats };
}

export function leaderboard(game: string): BoardRow[] {
  return as<BoardRow[]>(
    db.prepare(`
      SELECT p.id, p.name, p.seed, r.rating, r.played, r.wins
      FROM ratings r JOIN players p ON p.id = r.player_id
      WHERE r.game = ? AND r.played > 0
      ORDER BY r.rating DESC LIMIT 20`).all(game),
  ).map((r) => ({ ...r, rating: Math.round(r.rating) }));
}

export function recent(limit = 6): RecentMatch[] {
  const matches = as<{ id: number; game: string; ended_at: number }[]>(
    db.prepare('SELECT id, game, ended_at FROM matches ORDER BY id DESC LIMIT ?').all(limit),
  );
  const seatsOf = db.prepare(`
    SELECT p.id, p.name, p.seed, mp.won FROM match_players mp JOIN players p ON p.id = mp.player_id
    WHERE mp.match_id = ? ORDER BY mp.seat`);
  return matches.map((m) => ({
    game: m.game,
    at: m.ended_at,
    players: as<(PlayerPublic & { won: number })[]>(seatsOf.all(m.id)).map((p) => ({ id: p.id, name: p.name, seed: p.seed, won: !!p.won })),
  }));
}

/** Store a finished match and update everyone's rating (pairwise Elo). */
export function recordMatch(game: string, ids: string[], winners: number[]) {
  const draw = winners.length === ids.length;
  const won = (i: number) => winners.includes(i);

  db.exec('BEGIN');
  try {
    const { lastInsertRowid } = db.prepare('INSERT INTO matches (game, ended_at) VALUES (?, ?)').run(game, Date.now());
    const seat = db.prepare('INSERT INTO match_players (match_id, player_id, seat, won) VALUES (?, ?, ?, ?)');
    const ensure = db.prepare('INSERT OR IGNORE INTO ratings (player_id, game) VALUES (?, ?)');
    const read = db.prepare('SELECT rating FROM ratings WHERE player_id = ? AND game = ?');
    const write = db.prepare('UPDATE ratings SET rating = rating + ?, played = played + 1, wins = wins + ? WHERE player_id = ? AND game = ?');

    const ratings = ids.map((id, i) => {
      seat.run(lastInsertRowid, id, i, won(i) && !draw ? 1 : 0);
      ensure.run(id, game);
      return as<{ rating: number }>(read.get(id, game)).rating;
    });

    const k = 32 / Math.max(1, ids.length - 1);
    const delta = ids.map(() => 0);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const expected = 1 / (1 + 10 ** ((ratings[j] - ratings[i]) / 400));
        const actual = won(i) === won(j) ? 0.5 : won(i) ? 1 : 0;
        delta[i] += k * (actual - expected);
        delta[j] -= k * (actual - expected);
      }
    }
    ids.forEach((id, i) => write.run(delta[i], won(i) && !draw ? 1 : 0, id, game));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

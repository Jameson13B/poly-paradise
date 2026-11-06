import { randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import { ENGINES, GAMES } from '../shared/games/index.ts';
import type { Outcome } from '../shared/games/types.ts';
import type { ClientMsg, PlayerPublic, Pulse, RoomView, ServerMsg } from '../shared/protocol.ts';
import { cleanName, NAME_RULES, newLinkCode } from './auth.ts';
import * as db from './db.ts';

export interface Conn {
  ws: WebSocket;
  me: PlayerPublic | null;
  room: Room | null;
}

interface Room {
  code: string;
  game: string;
  host: string;
  players: PlayerPublic[];
  status: RoomView['status'];
  state: unknown;
  outcome: Outcome | null;
  rematch: Set<string>;
  conns: Set<Conn>;
  touched: number;
}

const rooms = new Map<string, Room>();
const conns = new Set<Conn>();
let recent = db.recent();

// Consonants only: easy to read aloud, and no accidental words.
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += ALPHABET[randomInt(ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

function send(c: Conn, m: ServerMsg) {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m));
}

const sameAs = (id: string) => [...conns].filter((c) => c.me?.id === id);
const seatOf = (room: Room, id: string) => room.players.findIndex((p) => p.id === id);
const connectedIds = (room: Room) => new Set([...room.conns].map((c) => c.me!.id));

function viewFor(room: Room, c: Conn): RoomView {
  const you = seatOf(room, c.me!.id);
  const online = connectedIds(room);
  return {
    code: room.code,
    game: room.game,
    host: room.host,
    status: room.status,
    seats: room.players.map((p) => ({ ...p, connected: online.has(p.id) })),
    you,
    view: room.state == null ? null : ENGINES[room.game].view(room.state, you),
    outcome: room.outcome,
    rematch: [...room.rematch],
  };
}

function sync(room: Room) {
  room.touched = Date.now();
  for (const c of room.conns) send(c, { t: 'room', room: viewFor(room, c) });
}

function attach(c: Conn, room: Room) {
  c.room = room;
  room.conns.add(c);
  sync(room);
}

function begin(room: Room) {
  room.state = ENGINES[room.game].setup(room.players.length);
  room.status = 'playing';
  room.outcome = null;
  room.rematch.clear();
  sync(room);
  pulseAll();
}

function finish(room: Room, outcome: Outcome) {
  room.status = 'finished';
  room.outcome = outcome;
  db.recordMatch(room.game, room.players.map((p) => p.id), outcome.winners);
  recent = db.recent();
  for (const p of room.players) {
    const me = db.profile(p.id);
    if (me) for (const c of sameAs(p.id)) send(c, { t: 'me', me });
  }
  sync(room);
  pulseAll();
}

function leave(c: Conn) {
  const room = c.room;
  if (!room) return;
  const id = c.me!.id;
  const seat = seatOf(room, id);

  if (room.status === 'playing' && seat >= 0) {
    finish(room, { winners: room.players.flatMap((_, i) => (i === seat ? [] : [i])), note: `${c.me!.name} left the table` });
  } else if (room.status === 'waiting' && seat >= 0) {
    room.players.splice(seat, 1);
    if (room.host === id && room.players[0]) room.host = room.players[0].id;
  }
  room.rematch.delete(id);

  for (const other of sameAs(id)) {
    if (other.room !== room) continue;
    room.conns.delete(other);
    other.room = null;
    send(other, { t: 'room', room: null });
  }
  if (room.conns.size === 0 && room.status !== 'playing') rooms.delete(room.code);
  else sync(room);
  pulseAll();
}

function pulse(): Pulse {
  let open = 0;
  let playing = 0;
  for (const r of rooms.values()) {
    if (r.status === 'waiting') open++;
    else if (r.status === 'playing') playing++;
  }
  const online = new Set([...conns].map((c) => c.me?.id).filter(Boolean)).size;
  return { online, open, playing, recent };
}

/** Lobby screens get a heartbeat of what's happening so the place feels inhabited. */
function pulseAll() {
  const p = pulse();
  for (const c of conns) if (c.me && !c.room) send(c, { t: 'pulse', pulse: p });
}
setInterval(pulseAll, 5000).unref();

// Forget tables nobody has touched in a while.
setInterval(() => {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [code, r] of rooms) if (r.conns.size === 0 && r.touched < cutoff) rooms.delete(code);
}, 60_000).unref();

export function connect(ws: WebSocket): Conn {
  const c: Conn = { ws, me: null, room: null };
  conns.add(c);
  return c;
}

export function disconnect(c: Conn) {
  conns.delete(c);
  if (c.room) {
    c.room.conns.delete(c);
    sync(c.room);
  }
}

export function handle(c: Conn, m: ClientMsg) {
  if (m.t === 'hello') {
    const me = typeof m.token === 'string' && m.token.length <= 128 ? db.sessionPlayer(m.token) : null;
    if (!me) return send(c, { t: 'signedOut' });
    c.me = me;
    send(c, { t: 'me', me: db.profile(c.me.id)! });
    // Phones sleep and refreshes happen: put returning players back at their table.
    const room = [...rooms.values()].find((r) => seatOf(r, c.me!.id) >= 0);
    if (room) attach(c, room);
    else send(c, { t: 'room', room: null });
    send(c, { t: 'pulse', pulse: pulse() });
    return;
  }
  const me = c.me;
  if (!me) return;

  switch (m.t) {
    case 'rename': {
      const name = cleanName(m.name);
      if (!name) return send(c, { t: 'error', message: NAME_RULES });
      if (!db.rename(me.id, name)) return send(c, { t: 'error', message: 'That name is taken' });
      for (const other of sameAs(me.id)) {
        other.me = { ...me, name };
        send(other, { t: 'me', me: db.profile(me.id)! });
      }
      for (const r of rooms.values()) {
        const seat = seatOf(r, me.id);
        if (seat >= 0) {
          r.players[seat] = { ...r.players[seat], name };
          sync(r);
        }
      }
      return;
    }

    case 'create': {
      const info = GAMES.find((g) => g.id === m.game && g.ready);
      if (!info) return send(c, { t: 'error', message: "That game isn't ready yet" });
      if (c.room) leave(c);
      const room: Room = {
        code: newCode(),
        game: info.id,
        host: me.id,
        players: [me],
        status: 'waiting',
        state: null,
        outcome: null,
        rematch: new Set(),
        conns: new Set(),
        touched: Date.now(),
      };
      rooms.set(room.code, room);
      attach(c, room);
      pulseAll();
      return;
    }

    case 'join': {
      const room = rooms.get(String(m.code ?? '').trim().toUpperCase());
      if (!room) return send(c, { t: 'error', message: 'No table with that code' });
      if (c.room === room) return;
      if (seatOf(room, me.id) < 0) {
        if (room.status !== 'waiting') return send(c, { t: 'error', message: 'That game has already started' });
        if (room.players.length >= GAMES.find((g) => g.id === room.game)!.players[1]) return send(c, { t: 'error', message: 'That table is full' });
        room.players.push(me);
      }
      if (c.room) leave(c);
      attach(c, room);
      pulseAll();
      return;
    }

    case 'leave':
      return leave(c);

    case 'start': {
      const room = c.room;
      if (!room || room.status !== 'waiting' || room.host !== me.id) return;
      if (room.players.length < GAMES.find((g) => g.id === room.game)!.players[0]) return;
      return begin(room);
    }

    case 'move': {
      const room = c.room;
      if (!room || room.status !== 'playing') return;
      const seat = seatOf(room, me.id);
      if (seat < 0) return;
      const engine = ENGINES[room.game];
      const next = engine.move(room.state, seat, m.move);
      if (typeof next === 'string') return send(c, { t: 'error', message: next });
      room.state = next;
      const outcome = engine.outcome(next);
      return outcome ? finish(room, outcome) : sync(room);
    }

    case 'rematch': {
      const room = c.room;
      if (!room || room.status !== 'finished' || seatOf(room, me.id) < 0) return;
      room.rematch.add(me.id);
      const here = connectedIds(room);
      if (![...here].every((id) => room.rematch.has(id))) return sync(room);
      // Everyone still here is in. Rotate seats so someone else moves first.
      room.players = room.players.filter((p) => here.has(p.id));
      room.players.push(room.players.shift()!);
      if (!here.has(room.host)) room.host = room.players[0].id;
      if (room.players.length >= GAMES.find((g) => g.id === room.game)!.players[0]) return begin(room);
      room.status = 'waiting';
      room.state = null;
      room.outcome = null;
      room.rematch.clear();
      return sync(room);
    }

    case 'linkCode':
      return send(c, { t: 'linkCode', ...newLinkCode(me.id) });

    case 'board':
      return send(c, { t: 'board', game: String(m.game), rows: db.leaderboard(String(m.game)) });

    case 'profile': {
      const profile = db.profile(String(m.id));
      if (profile) send(c, { t: 'profile', profile });
      return;
    }
  }
}

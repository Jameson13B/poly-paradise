import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { api } from './auth.ts';
import * as rooms from './rooms.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve('dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  if (url.pathname === '/up') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (url.pathname.startsWith('/api/')) {
    return api(req, res, url.pathname).catch((err) => {
      console.error('api failed', url.pathname, err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  }

  let file: string;
  try {
    file = resolve(DIST, '.' + decodeURIComponent(url.pathname));
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    res.writeHead(400);
    return res.end();
  }

  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    // Unknown paths without an extension are app routes (like /j/ABCD).
    if (!extname(file)) file = join(DIST, 'index.html');
  }

  try {
    const body = await readFile(file);
    const immutable = file.startsWith(join(DIST, 'assets') + sep);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const alive = new WeakSet<WebSocket>();

wss.on('connection', (ws) => {
  const conn = rooms.connect(ws);
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      rooms.handle(conn, msg);
    } catch (err) {
      console.error('message failed', msg.t, err);
    }
  });
  ws.on('close', () => rooms.disconnect(conn));
});

// Drop sockets from devices that vanished without saying goodbye.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 30_000).unref();

server.listen(PORT, () => console.log(`Poly Paradise server on :${PORT}`));

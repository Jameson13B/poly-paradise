# Poly Paradise

Party games played across everyone's own devices, set in one low-poly world.
Built mobile first and meant to be installed as a PWA.
The lobby is the island: it's where you see who's around, what was just played,
and where you stand. It isn't a menu you click past.

## Run it

```sh
npm install
npm run dev        # game server on :8787 + Vite on :5173 (also exposed on your LAN)
```

Open the **Network** URL that Vite prints (not localhost) so phones on the same
Wi-Fi can scan the table's QR code. Browsers only offer to install the PWA on
https (or localhost), so test installing on a deployed copy. `npm run build && npm start` serves the
production build. The Docker image serves HTTP on port 80, answers `/up`, and
keeps its SQLite database in `/storage` (where ONCE mounts its volume).

## How it fits together

```
shared/   protocol types + game engines (pure functions, run on the server)
server/   HTTP + WebSocket, rooms, SQLite (node:sqlite), Elo ratings
client/   Preact PWA: lobby, tables, game views
  three/  low-poly 3D scenes (three.js): the island, Fleet's sea, the Dots board
```

- **Server is authoritative.** Clients send intents (`move`), the server validates
  against the engine and pushes each seat its own `view` (hidden info, e.g. Fleet's
  ships, stays server-side).
- **Joining is by code + QR.** Codes are 4 consonants (`BCDF`, readable aloud). The QR
  holds `/j/CODE`, so a phone camera drops you straight into the table.
- **First load shows an install guide** for the visitor's device and browser (iOS Safari,
  Android Chrome/Samsung/Firefox, desktop Chrome/Edge/Safari), with a one-tap Install button
  where the browser supports it. It comes before sign-up so people who install create
  their account inside the app.
- **Accounts are a player name + password** (scrypt-hashed; sessions stay signed in until
  sign-out). The name is unique and is also what everyone sees.
- **Link codes move an account between devices.** A signed-in device shows a 6-character
  code (5 minutes, single use) and the other device enters it. This matters on iOS, where
  the Home Screen app doesn't share storage with Safari.
- **Mobile first:** phones get a bottom tab bar (Play / Ranks / You) and a pinned Start
  button; wider screens show everything at once.
- **Reconnects are seamless.** A phone that sleeps or a page that refreshes gets put
  back at its table. Disconnecting never forfeits; pressing Leave does.
- **Low-poly 3D, crisp UI.** The world and the boards are flat-shaded three.js scenes;
  text, buttons and forms stay HTML on top. three.js loads after first paint, scenes
  sleep when nothing moves or the tab is hidden, and devices without WebGL get the
  flat 2D boards and backdrop instead.
- **The lobby is the island.** It frames itself in the lobby's `.island-window`, with a
  figure at the campfire for each person online and a stall for each game. At a table it
  drifts off to rest under the board.
- **The backdrop shifts hue** toward whichever game is on the table, so the lobby and
  the games share one world.
- **Games so far:** Dots & Boxes (2–4 players) and Fleet (2 players, 8×8, ships of
  4-3-3-2-2). In Fleet, each seat only ever receives its own ships plus what its shots
  have revealed. The other fleet is sent once the game ends.
- **Stack Duel** is realtime but still uses the turn-based `Engine`. Each device runs its own
  falling-blocks board so controls are instant, and sends each landed piece. The server
  checks it with the same shared `lock()` code, clears rows, and sends junk to the rival.
  Both players get the same piece order from a shared seed. Junk enters only on pieces the
  client has acknowledged, so the two copies of a board never disagree.
- **Adding a game:** write an `Engine` in `shared/games/`, register it in
  `shared/games/index.ts`, add a view in `client/games/`.

## Principles for coming back without being manipulated

- No push notifications, no streaks that punish missing a day, no countdown FOMO.
- Rewards come from playing *with people*: rivalries, head-to-head records, rematches.
- Challenges are opt-in goals that never expire into a loss.
- The lobby shows real activity (who's here, what just finished), never fake urgency.

## Roadmap

1. **Paddle**: a server tick loop for one shared ball, with input messages and client
   interpolation. Paddle spans two screens, so each device renders its half.
2. **Account recovery**: there's no password reset yet. Options are an optional email
   address, or passkeys once the app is on its real domain.
3. **Rivals**: head-to-head records on profiles ("you're 4–2 against Mossy Heron").
4. **Challenges**: weekly, opt-in ("win a game of Dots without the first box"),
   with cosmetic gem facets/colors as rewards.
5. **Spectators**: join a running table by code to watch.

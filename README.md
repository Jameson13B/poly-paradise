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
keeps its SQLite database in `/data`.

## How it fits together

```
shared/   protocol types + game engines (pure functions, run on the server)
server/   HTTP + WebSocket, rooms, SQLite (node:sqlite), Elo ratings
client/   Preact PWA: living low-poly backdrop, lobby, tables, game views
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
- **The backdrop shifts hue** toward whichever game is on the table, so the lobby and
  the games share one world.
- **Adding a game:** write an `Engine` in `shared/games/`, register it in
  `shared/games/index.ts`, add a view in `client/games/`.

## Principles for coming back without being manipulated

- No push notifications, no streaks that punish missing a day, no countdown FOMO.
- Rewards come from playing *with people*: rivalries, head-to-head records, rematches.
- Challenges are opt-in goals that never expire into a loss.
- The lobby shows real activity (who's here, what just finished), never fake urgency.

## Roadmap

1. **Fleet** (turn-based, hidden info) to prove out per-seat views.
2. **Realtime engine path** for Paddle and Stack Duel: server tick loop, input
   messages, client interpolation. Paddle spans two screens, so each device renders its half.
3. **Account recovery**: there's no password reset yet. Options are an optional email
   address, or passkeys once the app is on its real domain.
4. **Rivals**: head-to-head records on profiles ("you're 4–2 against Mossy Heron").
5. **Challenges**: weekly, opt-in ("win a game of Dots without the first box"),
   with cosmetic gem facets/colors as rewards.
6. **Spectators**: join a running table by code to watch.

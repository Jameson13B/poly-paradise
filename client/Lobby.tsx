import { useEffect, useState } from 'preact/hooks';
import { GAMES, gameInfo } from '../shared/games/index.ts';
import type { GameInfo } from '../shared/games/types.ts';
import type { GameStat, Profile, Pulse } from '../shared/protocol.ts';
import { Gem, ago, hashStr } from './art.tsx';
import { isStandalone } from './install.ts';
import { send, signOut, type NetState } from './net.ts';

const CODE_CHARS = /[^BCDFGHJKLMNPQRSTVWXZ]/g;

type Tab = 'play' | 'ranks' | 'you';

const TAB_ICONS: Record<Tab, string> = {
  play: '12,2 22,8 22,16 12,22 2,16 2,8',
  ranks: '3,21 3,13 9,13 9,21 15,21 15,6 21,6 21,21',
  you: '12,2 20,9 12,22 4,9',
};

/**
 * On phones the lobby is three tabs with a bottom bar. Wider screens show
 * everything at once and drop the bar.
 */
export function Lobby({ net, onInstall }: { net: NetState; onInstall: () => void }) {
  const me = net.me!;
  const [tab, setTab] = useState<Tab>('play');

  return (
    <div class="lobby" data-tab={tab}>
      <header class="topbar">
        <h1 class="wordmark">
          <span>Poly</span> Paradise
        </h1>
        <button class="me-chip facet" onClick={() => setTab('you')} aria-label="Your profile">
          <Gem seed={me.seed} size={28} />
          <span>{me.name}</span>
        </button>
      </header>

      <div class="lobby-grid">
        <div class="pane pane-play">
          <PulseBadge pulse={net.pulse} />
          <section class="hero">
            {/* The 3D island frames itself inside this space. */}
            <div class="island-window" aria-hidden="true" />
            <div>
              <p class="eyebrow">{me.stats.some((s) => s.played > 0) ? `Welcome back, ${me.name}` : `Welcome, ${me.name}`}</p>
              <h2>Pull up a seat.</h2>
              <p class="muted">Open a table here, and everyone joins from their own device.</p>
            </div>
            <JoinCode />
          </section>
          <section>
            <h3 class="section-title">Open a table</h3>
            <div class="shelf">
              {GAMES.map((g) => (
                <GameCard game={g} stat={me.stats.find((s) => s.game === g.id)} />
              ))}
            </div>
          </section>
          <Recent pulse={net.pulse} />
        </div>

        <div class="pane pane-ranks">
          <Leaderboard net={net} />
        </div>

        <div class="pane pane-you">
          <You me={me} linkCode={net.linkCode} onInstall={onInstall} />
        </div>
      </div>

      <nav class="tabbar" aria-label="Lobby">
        {(['play', 'ranks', 'you'] as Tab[]).map((t) => (
          <button class={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polygon points={TAB_ICONS[t]} />
            </svg>
            {t === 'play' ? 'Play' : t === 'ranks' ? 'Ranks' : 'You'}
          </button>
        ))}
      </nav>
    </div>
  );
}

function PulseBadge({ pulse }: { pulse: Pulse | null }) {
  return (
    <p class="pulse">
      {pulse && (
        <>
          <i class="dot" />
          {pulse.online} here · {pulse.playing} playing · {pulse.open} open
        </>
      )}
    </p>
  );
}

function JoinCode() {
  const [code, setCode] = useState('');
  const update = (v: string) => {
    const next = v.toUpperCase().replace(CODE_CHARS, '').slice(0, 4);
    setCode(next);
    if (next.length === 4) {
      send({ t: 'join', code: next });
      setTimeout(() => setCode(''), 400);
    }
  };
  return (
    <form class="join panel facet" onSubmit={(e) => e.preventDefault()}>
      <p class="eyebrow">Join with a code</p>
      <label class="code-tiles">
        <input
          value={code}
          onInput={(e) => update(e.currentTarget.value)}
          autocomplete="off"
          autocapitalize="characters"
          spellcheck={false}
          aria-label="Table code"
        />
        {[0, 1, 2, 3].map((i) => (
          <span class={`tile${i === code.length ? ' active' : ''}`}>{code[i] ?? ''}</span>
        ))}
      </label>
      <p class="muted small">Or scan a table's QR code with your camera.</p>
    </form>
  );
}

function GameCard({ game, stat }: { game: GameInfo; stat?: GameStat }) {
  const [min, max] = game.players;
  return (
    <article class={`card facet${game.ready ? '' : ' soon'}`} style={{ '--hue': game.hue }}>
      <Gem seed={hashStr(game.id)} hue={game.hue} size={52} />
      <div class="card-body">
        <h4>{game.name}</h4>
        <p class="muted">{game.blurb}</p>
        <p class="meta">
          {min === max ? `${min} players` : `${min}–${max} players`}
          {stat && ` · ${stat.rating} rating`}
        </p>
      </div>
      {game.ready ? (
        <button class="btn" onClick={() => send({ t: 'create', game: game.id })}>
          Open table
        </button>
      ) : (
        <span class="badge">In the workshop</span>
      )}
    </article>
  );
}

function Leaderboard({ net }: { net: NetState }) {
  const ready = GAMES.filter((g) => g.ready);
  const [game, setGame] = useState(ready[0].id);
  const rows = net.boards[game];
  // Refresh whenever the lobby's pulse changes, so new results show up.
  useEffect(() => send({ t: 'board', game }), [game, net.pulse?.recent[0]?.at]);

  return (
    <div class="panel facet board">
      <div class="panel-head">
        <h3 class="section-title">Leaderboard</h3>
        {ready.length > 1 && (
          <div class="tabs">
            {ready.map((g) => (
              <button class={g.id === game ? 'on' : ''} onClick={() => setGame(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {!rows ? (
        <p class="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p class="muted">No one's on the board yet. Finish a game to claim the top spot.</p>
      ) : (
        <ol class="ranks">
          {rows.map((r, i) => (
            <li class={r.id === net.me!.id ? 'mine' : ''}>
              <span class="rank">{i + 1}</span>
              <Gem seed={r.seed} size={26} />
              <span class="name">{r.name}</span>
              <span class="num">{r.rating}</span>
              <span class="muted small">
                {r.wins}/{r.played}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Recent({ pulse }: { pulse: Pulse | null }) {
  const recent = pulse?.recent ?? [];
  return (
    <section class="panel facet">
      <h3 class="section-title">Just played</h3>
      {recent.length === 0 ? (
        <p class="muted">The island is quiet. Open a table and make some noise.</p>
      ) : (
        <ul class="feed">
          {recent.map((m) => {
            const winners = m.players.filter((p) => p.won);
            return (
              <li>
                <span class="faces">
                  {m.players.map((p) => (
                    <Gem seed={p.seed} size={22} />
                  ))}
                </span>
                <span>
                  {winners.length ? <b>{winners.map((p) => p.name).join(' & ')}</b> : 'A draw'}
                  {winners.length ? ' won ' : ' at '}
                  {gameInfo(m.game).name}
                  <span class="muted small"> · {ago(m.at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function You({ me, linkCode, onInstall }: { me: Profile; linkCode: NetState['linkCode']; onInstall: () => void }) {
  const [name, setName] = useState(me.name);
  useEffect(() => setName(me.name), [me.name]);

  return (
    <div class="you">
      <div class="panel facet">
        <div class="you-head">
          <Gem seed={me.seed} size={64} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send({ t: 'rename', name });
            }}
          >
            <label class="field-label" for="rename">
              Player name
            </label>
            <div class="row">
              <input id="rename" class="field" value={name} maxLength={20} onInput={(e) => setName(e.currentTarget.value)} />
              <button class="btn" disabled={!name.trim() || name.trim() === me.name}>
                Save
              </button>
            </div>
          </form>
        </div>
        <p class="muted small">On the island since {new Date(me.joined).toLocaleDateString()}</p>
      </div>

      <div class="panel facet">
        <h3 class="section-title">Your record</h3>
        {me.stats.length === 0 ? (
          <p class="muted">No games yet. Your stats show up here after your first game.</p>
        ) : (
          <table class="stats">
            <thead>
              <tr>
                <th>Game</th>
                <th>Played</th>
                <th>Won</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {me.stats.map((s) => (
                <tr>
                  <td>{gameInfo(s.game).name}</td>
                  <td>{s.played}</td>
                  <td>{s.wins}</td>
                  <td>{s.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <LinkDevice linkCode={linkCode} />

      <div class="panel facet you-actions">
        {!isStandalone() && (
          <button class="btn ghost" onClick={onInstall}>
            Install the app
          </button>
        )}
        <button class="btn ghost" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function LinkDevice({ linkCode }: { linkCode: NetState['linkCode'] }) {
  const [now, setNow] = useState(Date.now());
  const live = linkCode && linkCode.expires > now;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  const left = live ? Math.ceil((linkCode.expires - now) / 1000) : 0;

  return (
    <div class="panel facet link-device">
      <h3 class="section-title">Link a device</h3>
      <p class="muted">
        Signing in on a new phone, or in the installed app? Get a code here, then choose <b>Use a code</b> on the other device.
      </p>
      {live ? (
        <>
          <div class="code-tiles link-code">
            {linkCode.code.split('').map((ch) => (
              <span class="tile">{ch}</span>
            ))}
          </div>
          <p class="muted small">
            Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more.
          </p>
        </>
      ) : (
        <button
          class="btn"
          onClick={() => {
            setNow(Date.now());
            send({ t: 'linkCode' });
          }}
        >
          Get a link code
        </button>
      )}
    </div>
  );
}

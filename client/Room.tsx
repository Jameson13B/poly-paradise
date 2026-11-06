import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { gameInfo } from '../shared/games/index.ts';
import type { RoomView } from '../shared/protocol.ts';
import { Gem, hashStr } from './art.tsx';
import { GAME_UI } from './games/index.ts';
import { send } from './net.ts';

export function Room({ room }: { room: RoomView }) {
  const info = gameInfo(room.game);
  const leave = () => {
    if (room.status === 'playing' && !confirm('Leaving now forfeits this game. Leave anyway?')) return;
    send({ t: 'leave' });
  };
  const UI = GAME_UI[room.game];

  return (
    <section class="room">
      <header class="room-bar">
        <button class="btn ghost" onClick={leave}>
          ← Lobby
        </button>
        <span class="room-title">
          <Gem seed={hashStr(info.id)} hue={info.hue} size={28} />
          {info.name}
        </span>
        <span class="muted mono">{room.code}</span>
      </header>
      {room.status === 'waiting' ? (
        <Waiting room={room} />
      ) : (
        <div class="play">
          <UI room={room} />
          {room.status === 'finished' && <Result room={room} />}
        </div>
      )}
    </section>
  );
}

function Waiting({ room }: { room: RoomView }) {
  const info = gameInfo(room.game);
  const url = `${location.origin}/j/${room.code}`;
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0b1020', light: '#f2f6ff' } }).then(setQr);
  }, [url]);

  const [min, max] = info.players;
  const isHost = room.seats[room.you]?.id === room.host;
  const short = min - room.seats.length;
  const onLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

  return (
    <div class="waiting">
      <div class="invite panel facet">
        <p class="eyebrow">Table code</p>
        <div class="code-tiles big" aria-label={`Code ${room.code.split('').join(' ')}`}>
          {room.code.split('').map((ch) => (
            <span class="tile">{ch}</span>
          ))}
        </div>
        <div class="qr facet" dangerouslySetInnerHTML={{ __html: qr }} />
        <p class="muted small">Scan with another device's camera, or type the code in the lobby.</p>
        {onLocalhost && (
          <p class="hint">
            This is a localhost address, which other devices can't reach. Open the Network URL Vite printed so the QR code works.
          </p>
        )}
        {'share' in navigator && (
          <button class="btn ghost" onClick={() => navigator.share({ title: 'Poly Paradise', text: `Join my ${info.name} table: ${room.code}`, url }).catch(() => {})}>
            Share invite
          </button>
        )}
      </div>

      <div class="seats panel facet">
        <p class="eyebrow">
          Seats {room.seats.length}/{max}
        </p>
        <ul>
          {room.seats.map((s, i) => (
            <li class={s.connected ? '' : 'away'}>
              <Gem seed={s.seed} size={36} />
              <span class="name">
                {s.name}
                {i === room.you && <span class="muted"> (you)</span>}
              </span>
              {s.id === room.host && <span class="badge">host</span>}
            </li>
          ))}
          {Array.from({ length: max - room.seats.length }, () => (
            <li class="open">
              <span class="empty-gem" />
              <span class="muted">Open seat</span>
            </li>
          ))}
        </ul>
        {!isHost && <p class="muted">The host starts the game when everyone's here.</p>}
      </div>
      {/* Outside the panel: its backdrop-filter would trap position: fixed. */}
      {isHost && (
        <button class="btn room-action" disabled={short > 0} onClick={() => send({ t: 'start' })}>
          {short > 0 ? `Waiting for ${short} more…` : 'Start game'}
        </button>
      )}
    </div>
  );
}

function Result({ room }: { room: RoomView }) {
  const { winners, note } = room.outcome!;
  const draw = winners.length === room.seats.length;
  const title = draw
    ? "It's a draw"
    : winners.includes(room.you)
      ? 'You won!'
      : `${winners.map((i) => room.seats[i].name).join(' & ')} won`;
  const myId = room.seats[room.you]?.id;
  const voted = !!myId && room.rematch.includes(myId);
  const here = room.seats.filter((s) => s.connected).length;

  return (
    <div class="result panel facet">
      <h2>{title}</h2>
      {note && <p class="muted">{note}</p>}
      <div class="row">
        <button class="btn" disabled={voted} onClick={() => send({ t: 'rematch' })}>
          {voted ? `Waiting… ${room.rematch.length}/${here}` : room.rematch.length ? `Rematch (${room.rematch.length}/${here})` : 'Rematch'}
        </button>
        <button class="btn ghost" onClick={() => send({ t: 'leave' })}>
          Back to lobby
        </button>
      </div>
    </div>
  );
}

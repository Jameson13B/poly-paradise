import { useState } from 'preact/hooks';
import { GAMES, gameInfo } from '../shared/games/index.ts';
import { PolyField } from './art.tsx';
import { Auth } from './Auth.tsx';
import { InstallGuide } from './Install.tsx';
import { guideSeen, isStandalone, markGuideSeen } from './install.ts';
import { Lobby } from './Lobby.tsx';
import { useNet } from './net.ts';
import { Room } from './Room.tsx';
import { Canvas3D } from './three/Canvas3D.tsx';
import type { WorldProps } from './three/world.ts';

const LOBBY_HUE = 196;
const loadWorld = () => import('./three/world.ts');
const STALLS = GAMES.map((g) => ({ hue: g.hue, ready: g.ready }));

/** The 3D island behind everything, with the flat field showing until it has loaded (or if there's no WebGL). */
function World(props: WorldProps) {
  const [ready, setReady] = useState(false);
  return (
    <>
      {!ready && <PolyField hue={props.hue} />}
      <Canvas3D load={loadWorld} props={props} class="world" fallback={null} onReady={() => (setReady(true), document.documentElement.classList.add('world-3d'))} />
    </>
  );
}

export function App() {
  const net = useNet();
  // The install guide comes before sign-up so people who install create their
  // account inside the app (on iOS the app and Safari don't share sign-ins).
  const [guide, setGuide] = useState(() => !isStandalone() && !guideSeen());
  const hue = net.room ? gameInfo(net.room.game).hue : LOBBY_HUE;

  let screen;
  if (guide)
    screen = (
      <InstallGuide
        onDone={() => {
          markGuideSeen();
          setGuide(false);
        }}
      />
    );
  else if (!net.signedIn) screen = <Auth />;
  else if (!net.me)
    screen = (
      <div class="splash">
        <h1 class="wordmark">
          <span>Poly</span> Paradise
        </h1>
        <p class="muted">{net.link === 'offline' ? 'Looking for the island…' : 'Arriving…'}</p>
      </div>
    );
  else if (net.room) screen = <Room room={net.room} />;
  else screen = <Lobby net={net} onInstall={() => setGuide(true)} />;

  return (
    <>
      <World hue={hue} away={!!net.room} online={net.pulse?.online ?? 1} stalls={STALLS} />
      <main class="shell">{screen}</main>
      {net.me && net.link === 'offline' && <div class="toast warn">Connection lost, reconnecting…</div>}
      {net.error && (
        <div class="toast" role="alert">
          {net.error}
        </div>
      )}
    </>
  );
}

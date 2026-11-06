import { useState } from 'preact/hooks';
import { gameInfo } from '../shared/games/index.ts';
import { PolyField } from './art.tsx';
import { Auth } from './Auth.tsx';
import { InstallGuide } from './Install.tsx';
import { guideSeen, isStandalone, markGuideSeen } from './install.ts';
import { Lobby } from './Lobby.tsx';
import { useNet } from './net.ts';
import { Room } from './Room.tsx';

const LOBBY_HUE = 196;

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
      <PolyField hue={hue} />
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

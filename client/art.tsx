import { useEffect, useRef } from 'preact/hooks';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const SEAT_HUES = [168, 340, 42, 262];
export const seatColor = (seat: number, light = 62) => `hsl(${SEAT_HUES[seat % SEAT_HUES.length]} 78% ${light}%)`;

/** A faceted hexagon gem, unique per seed. Used for avatars and game badges. */
export function Gem({ seed, hue, size = 40 }: { seed: number; hue?: number; size?: number }) {
  const r = rng(seed);
  const base = hue ?? Math.floor(r() * 360);
  const cx = 50 + (r() - 0.5) * 18;
  const cy = 50 + (r() - 0.5) * 18;
  const verts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const rad = 47 - r() * 7;
    return [50 + Math.cos(a) * rad, 50 + Math.sin(a) * rad];
  });
  return (
    <svg class="gem" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      {verts.map((v, i) => {
        const n = verts[(i + 1) % 6];
        const facing = Math.atan2((v[1] + n[1]) / 2 - cy, (v[0] + n[0]) / 2 - cx);
        const light = 50 + 20 * Math.cos(facing + 2.3) + (r() - 0.5) * 8;
        const h = base + (r() - 0.5) * 26;
        return <polygon points={`${cx},${cy} ${v[0]},${v[1]} ${n[0]},${n[1]}`} fill={`hsl(${h} 64% ${light}%)`} />;
      })}
    </svg>
  );
}

interface Pt {
  x: number;
  y: number;
  z: number;
  ph: number;
}

const L = (() => {
  const v = [-0.5, -0.7, 0.9];
  const m = Math.hypot(...v);
  return v.map((x) => x / m);
})();

/**
 * The living low-poly landscape behind every screen. It drifts slowly and
 * shifts hue toward whatever game is on the table, so the lobby and the
 * games share one world.
 */
export function PolyField({ hue }: { hue: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef(hue);
  const kick = useRef<() => void>(() => {});
  target.current = hue;

  useEffect(() => kick.current(), [hue]);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pts: Pt[] = [];
    let cols = 0;
    let rows = 0;
    let cell = 0;
    let h = 0;
    let current = target.current;
    let raf = 0;
    let last = 0;

    function layout() {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = innerWidth;
      h = innerHeight;
      el.width = w * dpr;
      el.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = Math.max(70, Math.min(w, h) / 6);
      cols = Math.ceil(w / cell) + 2;
      rows = Math.ceil(h / cell) + 2;
      const r = rng(7);
      pts = [];
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++)
          pts.push({ x: (x - 0.5) * cell + (r() - 0.5) * cell * 0.75, y: (y - 0.5) * cell + (r() - 0.5) * cell * 0.75, z: r(), ph: r() * Math.PI * 2 });
    }

    function tri(a: Pt, b: Pt, c: Pt, t: number) {
      const z = (p: Pt) => (p.z + (still ? 0 : Math.sin(t * 0.00035 + p.ph) * 0.3)) * cell * 0.7;
      const za = z(a);
      const ux = b.x - a.x, uy = b.y - a.y, uz = z(b) - za;
      const vx = c.x - a.x, vy = c.y - a.y, vz = z(c) - za;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nz < 0) (nx = -nx), (ny = -ny), (nz = -nz);
      const shade = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / Math.hypot(nx, ny, nz));
      const depth = Math.min(1, Math.max(0, (a.y + b.y + c.y) / 3 / h));
      ctx.fillStyle = `hsl(${current - 25 + depth * 50} 48% ${10 + shade * 22 + (1 - depth) * 6}%)`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.stroke();
    }

    function frame(t: number) {
      raf = 0;
      if (document.hidden) return;
      const delta = ((target.current - current + 540) % 360) - 180;
      if (still || t - last > 33) {
        last = t;
        current += Math.abs(delta) < 0.5 ? delta : delta * 0.05;
        const at = (x: number, y: number) => pts[y * cols + x];
        for (let y = 0; y < rows - 1; y++)
          for (let x = 0; x < cols - 1; x++) {
            const [p, q, r, s] = [at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)];
            if ((x + y) % 2) tri(p, q, s, t), tri(p, s, r, t);
            else tri(p, q, r, t), tri(q, s, r, t);
          }
      }
      if (!still || Math.abs(delta) >= 0.5) raf = requestAnimationFrame(frame);
    }

    const run = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const resize = () => {
      layout();
      run();
    };
    kick.current = run;
    layout();
    run();
    addEventListener('resize', resize);
    document.addEventListener('visibilitychange', run);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', run);
    };
  }, []);

  return <canvas ref={canvas} class="polyfield" aria-hidden="true" />;
}

export function ago(at: number) {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

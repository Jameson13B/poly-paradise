import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { hasWebGL, type Scene3D, type SceneModule } from './support.ts';

interface Props<P> {
  /** Dynamic import of the scene, so three.js loads after the first paint. */
  load: () => Promise<SceneModule<P>>;
  props: P;
  class?: string;
  /** Leave out for decorative scenes, which are hidden from screen readers. */
  label?: string;
  /** Shown when WebGL is unavailable or the scene fails to start. */
  fallback: ComponentChildren;
  onReady?: () => void;
}

export function Canvas3D<P>({ load, props, class: cls = '', label, fallback, onReady }: Props<P>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene3D<P> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [failed, setFailed] = useState(() => !hasWebGL());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (failed) return;
    const el = canvas.current!;
    let alive = true;
    let ro: ResizeObserver | undefined;
    load()
      .then((m) => {
        if (!alive) return;
        const s = m.create(el, latest.current);
        scene.current = s;
        ro = new ResizeObserver(() => s.resize(el.clientWidth, el.clientHeight));
        ro.observe(el);
        s.resize(el.clientWidth, el.clientHeight);
        setReady(true);
        onReady?.();
      })
      .catch((err) => {
        console.warn('3D scene failed, using the flat board', err);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      ro?.disconnect();
      scene.current?.dispose();
      scene.current = null;
    };
  }, [failed]);

  useEffect(() => {
    scene.current?.update(props);
  });

  if (failed) return <>{fallback}</>;

  const at = (kind: 'move' | 'down' | 'leave' | 'tap') => (e: PointerEvent | MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    scene.current?.pointer?.(kind, e.clientX - r.left, e.clientY - r.top);
  };

  return (
    <canvas
      ref={canvas}
      class={`scene3d ${cls}${ready ? ' ready' : ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      onPointerMove={at('move')}
      onPointerDown={at('down')}
      onPointerLeave={at('leave')}
      onClick={at('tap')}
    />
  );
}

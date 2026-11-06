// Kept free of three.js imports so screens can decide on 3D before loading it.

let cached: boolean | undefined;

export function hasWebGL() {
  if (cached === undefined) {
    try {
      const c = document.createElement('canvas');
      cached = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      cached = false;
    }
  }
  return cached;
}

/** A scene that lives in one canvas. Props are pushed in on every render. */
export interface Scene3D<P> {
  update(props: P): void;
  resize(width: number, height: number): void;
  /** Pointer position in CSS pixels relative to the canvas. */
  pointer?(kind: 'move' | 'down' | 'leave' | 'tap', x: number, y: number): void;
  dispose(): void;
}

export type SceneModule<P> = { create(canvas: HTMLCanvasElement, props: P): Scene3D<P> };

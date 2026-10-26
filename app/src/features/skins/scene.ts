export type SceneMode = 'live' | 'frozen';
export type SceneInput = {
  kind: 'down' | 'move' | 'up' | 'cancel';
  x: number;
  y: number;
  pointerId: number;
  pointerType: string;
  button: number;
  time: number;
  screenX?: number;
  screenY?: number;
};
export type SceneRect = { left: number; top: number; width: number; height: number };

export function mapScenePoint(
  clientX: number,
  clientY: number,
  rect: SceneRect,
  width: number,
  height: number,
) {
  if (
    ![clientX, clientY, rect.left, rect.top, rect.width, rect.height, width, height].every(
      Number.isFinite,
    ) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const x = ((clientX - rect.left) * width) / rect.width;
  const y = ((clientY - rect.top) * height) / rect.height;
  return x < 0 || y < 0 || x >= width || y >= height ? null : { x, y };
}
export type SceneFrame<Data = unknown> = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  mode: SceneMode;
  view: string;
  data: Data;
};
export type SkinSceneRenderer<Data = unknown> = {
  draw(frame: SceneFrame<Data>): boolean;
  input?(event: SceneInput): void;
  dispose?(): void;
};
export type SkinSceneFactory<Data = unknown> = () => SkinSceneRenderer<Data>;

export class SceneScheduler {
  private pending: number | null = null;
  private active = false;
  private dirty = true;
  private disposed = false;
  private origin: number | null = null;

  constructor(
    private readonly draw: (time: number) => boolean,
    private mode: SceneMode = 'live',
    private readonly request: (callback: FrameRequestCallback) => number = (callback) =>
      requestAnimationFrame(callback),
    private readonly cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
    private readonly disposeRenderer: () => void = () => {},
  ) {}

  invalidate() {
    if (this.disposed) return;
    this.dirty = true;
    this.schedule();
  }

  setMode(mode: SceneMode) {
    if (this.disposed || this.mode === mode) return;
    this.mode = mode;
    this.origin = null;
    this.invalidate();
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      this.dirty = true;
      if (this.pending !== null) this.cancelPending();
      return;
    }
    this.origin = null;
    this.invalidate();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
    this.disposeRenderer();
  }

  private cancelPending() {
    if (this.pending === null) return;
    this.cancel(this.pending);
    this.pending = null;
  }

  private schedule() {
    if (
      this.pending !== null ||
      !this.active ||
      this.disposed ||
      (!this.dirty && this.mode === 'frozen')
    )
      return;
    this.pending = this.request((time) => {
      this.pending = null;
      if (!this.active || this.disposed) {
        this.dirty = true;
        return;
      }
      if (!this.dirty && this.mode === 'frozen') return;
      const elapsed =
        this.mode === 'frozen'
          ? 0
          : this.origin === null
            ? ((this.origin = time), 0)
            : time - this.origin;
      this.dirty = false;
      const animate = this.draw(elapsed);
      if (this.mode === 'live' && animate) {
        this.dirty = true;
        this.schedule();
      }
    });
  }
}

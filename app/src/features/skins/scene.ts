import type { SceneMode } from './scene-contracts';

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
    if (this.disposed) {
      return;
    }
    this.dirty = true;
    this.schedule();
  }

  setMode(mode: SceneMode) {
    if (this.disposed || this.mode === mode) {
      return;
    }
    this.mode = mode;
    this.origin = null;
    this.invalidate();
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) {
      return;
    }
    this.active = active;
    if (!active) {
      this.dirty = true;
      if (this.pending !== null) {
        this.cancelPending();
      }
      return;
    }
    this.origin = null;
    this.invalidate();
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelPending();
    this.disposeRenderer();
  }

  private cancelPending() {
    if (this.pending === null) {
      return;
    }
    this.cancel(this.pending);
    this.pending = null;
  }

  private schedule() {
    if (
      this.pending !== null ||
      !this.active ||
      this.disposed ||
      (!this.dirty && this.mode === 'frozen')
    ) {
      return;
    }
    this.pending = this.request((time) => {
      this.pending = null;
      if (!this.active || this.disposed) {
        this.dirty = true;
        return;
      }
      if (!this.dirty && this.mode === 'frozen') {
        return;
      }
      let elapsed = 0;
      if (this.mode !== 'frozen') {
        if (this.origin === null) {
          this.origin = time;
        } else {
          elapsed = time - this.origin;
        }
      }
      this.dirty = false;
      const animate = this.draw(elapsed);
      if (this.mode === 'live' && animate) {
        this.dirty = true;
        this.schedule();
      }
    });
  }
}

export type { SkinSceneFactory, SkinSceneRenderer } from './scene-contracts';

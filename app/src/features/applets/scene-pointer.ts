import type { AppletHostContext } from './context';
import type { SceneInput, AppletSceneRenderer } from './scene-contracts';

/** Owns capture and the in-flight scene gesture, including cancellation on visibility changes. */
export class ScenePointer {
  private pointer: SceneInput | null = null;

  constructor(
    private readonly host: {
      canvas(): HTMLCanvasElement;
      size(): { width: number; height: number };
      active(): boolean;
      context?: AppletHostContext;
      renderer(): AppletSceneRenderer | undefined;
    },
  ) {}

  cancel() {
    if (!this.pointer) {
      return;
    }
    const last = this.pointer;
    this.pointer = null;
    const canvas = this.host.canvas();
    try {
      if (canvas.hasPointerCapture(last.pointerId)) {
        canvas.releasePointerCapture(last.pointerId);
      }
    } catch {}
    this.dispatch(
      { ...last, kind: 'cancel', time: performance.now() },
      canvas.getBoundingClientRect(),
    );
    this.host.context?.resetSceneInput();
  }

  input(kind: SceneInput['kind'], event: PointerEvent) {
    if (kind === 'down') {
      this.down(event);
      return;
    }
    if (!this.pointer || this.pointer.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (kind === 'cancel' || !this.host.active()) {
      this.cancel();
      return;
    }
    const rect = this.host.canvas().getBoundingClientRect();
    const { width, height } = this.host.size();
    // Captured moves may be outside the canvas; preserve their unbounded coordinates.
    const next: SceneInput = {
      kind,
      x: ((event.clientX - rect.left) * width) / rect.width,
      y: ((event.clientY - rect.top) * height) / rect.height,
      pointerId: this.pointer.pointerId,
      pointerType: event.pointerType,
      button: event.button,
      time: performance.now(),
      screenX: event.clientX,
      screenY: event.clientY,
    };
    this.dispatch(next, rect);
    this.pointer = kind === 'up' ? null : next;
  }

  private down(event: PointerEvent) {
    if (this.pointer) {
      this.cancel();
      return;
    }
    if (!this.host.active() || !event.isPrimary || event.button !== 0) {
      return;
    }
    const canvas = this.host.canvas();
    const rect = canvas.getBoundingClientRect();
    const { width, height } = this.host.size();
    if (
      ![rect.width, rect.height, width, height].every((v) => v > 0) ||
      ![event.clientX, event.clientY].every(Number.isFinite)
    ) {
      return;
    }
    const point = {
      x: ((event.clientX - rect.left) * width) / rect.width,
      y: ((event.clientY - rect.top) * height) / rect.height,
    };
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
      return;
    }
    const next: SceneInput = {
      kind: 'down',
      ...point,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      button: event.button,
      time: performance.now(),
      screenX: event.clientX,
      screenY: event.clientY,
    };
    const renderer = this.host.renderer();
    const handled =
      this.host.context?.routeSceneInput(next, rect, (input) => renderer?.input?.(input)) ?? false;
    if (!renderer?.input && !handled) {
      return;
    }
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      this.host.context?.resetSceneInput();
      if (!handled) {
        renderer?.input?.(next);
      }
      return;
    }
    this.pointer = next;
    event.preventDefault();
    event.stopPropagation();
    if (!handled) {
      renderer?.input?.(next);
    }
  }

  private dispatch(input: SceneInput, rect: DOMRect) {
    const deliver = (event: SceneInput) => this.host.renderer()?.input?.(event);
    if (!this.host.context?.routeSceneInput(input, rect, deliver)) {
      deliver(input);
    }
  }
}

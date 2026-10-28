// Resize constraints, live outline and its cancellable settle animation.
import { tick } from 'svelte';
import { springDuration } from '$lib/spring';
import { clampResizeRect, fits, tileRadius, type Item } from '../grid';
import {
  itemBox,
  resizeFromCornerHysteretic,
  resizePreview,
  sameItemRect,
  type Box,
  type ResizeCorner,
} from '../drag-geometry';
import { reducedMotion } from './tile-motion.svelte';
import type { DeckDragHost, DragBase } from './deck-drag.svelte';

type CellSize = { w: number; h: number };
type CellRect = { x: number; y: number; w: number; h: number };
type ResizeFrameHandle = {
  settleTo(target: Box, duration?: number): Promise<void>;
  cancelSettle(): void;
};
export type ResizeDrag = DragBase & {
  mode: 'resize';
  corner: ResizeCorner;
  min: CellSize;
  max: CellSize;
  pixelObstacles: CellRect[];
  cellObstacles: CellRect[];
  frameRadius: number;
  target: Item;
  validResize: Item;
  ghost: Box;
  ok: boolean;
};
const RESIZE_HYSTERESIS = 4;

export class DeckResize {
  current = $state<ResizeDrag | null>(null);
  removal = $state<{ id: string; box: Box; invalid: boolean; radius: number } | null>(null);
  settlingFrame = $state<{
    id: string;
    from: Box;
    target: Box;
    token: number;
    radius: number;
  } | null>(null);
  frame = $state<ResizeFrameHandle | undefined>(undefined);
  readonly frameBox = $derived(
    this.current?.moved
      ? this.current.ghost
      : (this.settlingFrame?.from ?? this.removal?.box ?? null),
  );
  readonly frameInvalid = $derived(
    this.current?.moved ? !this.current.ok : (this.removal?.invalid ?? false),
  );
  readonly frameRadius = $derived.by(
    () =>
      this.current?.frameRadius ??
      this.settlingFrame?.radius ??
      this.removal?.radius ??
      tileRadius(this.host.metrics().cell),
  );
  private frameGeneration = 0;

  constructor(private readonly host: Pick<DeckDragHost, 'deck' | 'metrics' | 'limits'>) {}

  interruptSettle(id: string) {
    const radius = this.settlingFrame?.id === id ? this.settlingFrame.radius : null;
    if (this.settlingFrame) {
      this.frameGeneration++;
      this.settlingFrame = null;
      void tick().then(() => this.frame?.cancelSettle());
    }
    return radius;
  }

  begin(base: DragBase, corner: ResizeCorner, interruptedRadius: number | null) {
    const { min, max } = this.host.limits(base.item, corner);
    const { pitch, gap, item } = base;
    const others = this.host.deck().items.filter((other) => other.id !== item.id);
    this.current = {
      ...base,
      mode: 'resize',
      corner,
      min,
      max,
      cellObstacles: others.map(({ x, y, w, h }) => ({ x, y, w, h })),
      // Grow by a gap so the outline stops where the widget can actually end.
      pixelObstacles: others.map((other) => {
        const box = itemBox(other, pitch, gap);
        return { x: box.x - gap, y: box.y - gap, w: box.width + 2 * gap, h: box.height + 2 * gap };
      }),
      frameRadius:
        interruptedRadius ??
        Math.min(
          tileRadius(this.host.metrics().cell),
          (Math.min(min.w, item.w) * pitch - gap) / 2,
          (Math.min(min.h, item.h) * pitch - gap) / 2,
        ),
      target: item,
      validResize: item,
      ghost: itemBox(item, pitch, gap),
      ok: true,
    };
    return this.current;
  }

  release(drag: ResizeDrag, item: Item) {
    if (sameItemRect(drag.target, item)) {
      return null;
    }
    const next = this.host
      .deck()
      .items.map((entry) => (entry.id === item.id ? { ...entry, ...drag.target } : entry));
    this.settleResize(
      drag.id,
      drag.ghost,
      itemBox(drag.target, drag.pitch, drag.gap),
      drag.screenDistance,
      drag.frameRadius,
    );
    return next;
  }

  cancel(drag: ResizeDrag, animate: boolean) {
    if (drag.moved && animate) {
      this.settleResize(
        drag.id,
        drag.ghost,
        itemBox(drag.item, drag.pitch, drag.gap),
        drag.screenDistance,
        drag.frameRadius,
      );
    }
  }

  interruptForRemoval(id: string) {
    const drag = this.current;
    if (drag?.id === id && drag.moved) {
      this.removal = { id, box: drag.ghost, invalid: !drag.ok, radius: drag.frameRadius };
    }
    const settling = this.settlingFrame;
    if (settling?.id === id) {
      this.removal = { id, box: settling.from, invalid: false, radius: settling.radius };
      this.frameGeneration++;
      this.settlingFrame = null;
      this.frame?.cancelSettle();
    }
  }

  clearRemoval(id: string) {
    if (this.removal?.id === id) {
      this.removal = null;
    }
  }

  destroy() {
    this.frameGeneration++;
    this.current = null;
  }

  sample(drag: ResizeDrag) {
    const deck = this.host.deck();
    const source = itemBox(drag.item, drag.pitch, drag.gap);
    const preview = resizePreview(
      drag.item,
      drag.corner,
      drag.dx,
      drag.dy,
      drag.pitch,
      drag.gap,
      drag.min,
      drag.max,
    );
    const requested = {
      x: source.x + preview.x,
      y: source.y + preview.y,
      w: preview.width,
      h: preview.height,
    };
    const pixelMin = {
      w: drag.min.w * drag.pitch - drag.gap,
      h: drag.min.h * drag.pitch - drag.gap,
    };
    const ghost = clampResizeRect(requested, drag.pixelObstacles, drag.corner, pixelMin);
    if (!ghost) {
      drag.ok = false;
      return;
    }

    const effectiveDx = (ghost.w - source.width) * (drag.corner.includes('w') ? -1 : 1);
    const effectiveDy = (ghost.h - source.height) * (drag.corner.includes('n') ? -1 : 1);
    const snapped = {
      ...drag.item,
      ...resizeFromCornerHysteretic(
        drag.item,
        drag.corner,
        effectiveDx,
        effectiveDy,
        drag.pitch,
        drag.target,
        drag.min,
        drag.max,
        RESIZE_HYSTERESIS,
      ),
    };
    const safe = clampResizeRect(snapped, drag.cellObstacles, drag.corner, drag.min);
    if (!safe) {
      drag.ok = false;
      return;
    }
    const target = { ...drag.item, ...safe };
    if (!fits(deck.items, target, deck, [drag.id])) {
      drag.ok = false;
      return;
    }

    drag.target = target;
    drag.ok = true;
    drag.ghost = { x: ghost.x, y: ghost.y, width: ghost.w, height: ghost.h };
    if (!sameItemRect(target, drag.validResize)) {
      drag.validResize = target;
    }
  }

  settleResize(id: string, from: Box, target: Box, distance: number, radius: number) {
    const token = ++this.frameGeneration;
    if (reducedMotion()) {
      this.settlingFrame = null;
      return;
    }
    this.settlingFrame = { id, from, target, token, radius };
    const duration = Math.max(320, Math.min(380, springDuration(distance)));
    void tick()
      .then(() => {
        if (token !== this.frameGeneration || !this.frame) {
          return;
        }
        return this.frame.settleTo(target, duration);
      })
      .then(() => {
        if (token === this.frameGeneration && this.settlingFrame?.token === token) {
          this.settlingFrame = null;
        }
      })
      .catch(() => {});
  }
}

// One move or resize gesture on the deck grid: pointer tracking, placement previews (computed in a worker when
// other tiles are in the way), release rules and the settle animation. Committed layouts go through the host.
import { tick } from 'svelte';
import { springDuration } from '$lib/spring';
import {
  clampResizeRect,
  fits,
  inside,
  previewDrop,
  tileRadius,
  type DropPreview,
  type FittedDeck,
  type Grid,
  type Item,
  type Selection,
} from '../grid';
import {
  itemBox,
  projectMoveOrigin,
  resizeFromCornerHysteretic,
  resizePreview,
  type Box,
  type ResizeCorner,
} from '../drag-geometry';
import { DropPreviewWorker } from '../drop-worker';
import { readTranslation, reducedMotion, type TileMotion } from './tile-motion.svelte';

type CellSize = { w: number; h: number };
type CellRect = { x: number; y: number; w: number; h: number };

/** Pointer travel in logical pixels before a press becomes a drag. */
const DRAG_SLOP = 6;
/** Pixel deadband around each half-cell resize snap. */
const RESIZE_HYSTERESIS = 4;

export type DeckDragHost = {
  deck(): Grid & { items: Item[] };
  metrics(): FittedDeck;
  pitch(): number;
  grid(): HTMLElement | undefined;
  limits(item: Item, corner: ResizeCorner): { min: CellSize; max: CellSize };
  isRemoving(id: string): boolean;
  /** Identifies the layout a request was computed for; previews of another layout are dropped. */
  layoutSignature(): string;
  write(items: Item[], label: string): boolean;
  select(selection: Selection): void;
  motion: TileMotion;
};

type Drag = {
  id: string;
  item: Item;
  mode: 'move' | 'resize';
  pointerId: number;
  capture: HTMLElement;
  startX: number;
  startY: number;
  latest: { x: number; y: number };
  raf: number | null;
  grabOffsetX: number;
  grabOffsetY: number;
  baseX: number;
  baseY: number;
  screenDistance: number;
  corner: ResizeCorner;
  scale: number;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  pitch: number;
  gap: number;
  min: CellSize;
  max: CellSize;
  pixelObstacles: CellRect[];
  cellObstacles: CellRect[];
  frameRadius: number;
  target: Item;
  validResize: Item;
  ghost: Box;
  placement: DropPreview | null;
  ok: boolean;
  moved: boolean;
  moveX: number;
  moveY: number;
  pointerInside: boolean;
  pending: boolean;
  readyForRelease: boolean;
  generation: number;
  requestToken: number;
  layoutSignature: string;
  requestedX: number | null;
  requestedY: number | null;
  readyFrame: number | null;
};

type SettlingFrame = { id: string; from: Box; target: Box; token: number; radius: number };
type ResizeFrameHandle = {
  settleTo(target: Box, duration?: number): Promise<void>;
  cancelSettle(): void;
};

export class DeckDrag {
  current = $state<Drag | null>(null);
  /** A move or resize interrupted by its tile's removal keeps its outline until the removal ends. */
  removalMove = $state<Drag | null>(null);
  removalResize = $state<{ id: string; box: Box; invalid: boolean; radius: number } | null>(null);
  settlingFrame = $state<SettlingFrame | null>(null);
  resizeFrame = $state<ResizeFrameHandle | undefined>(undefined);

  readonly frameBox = $derived.by(() => {
    const drag = this.current;
    if (drag?.mode === 'resize' && drag.moved) {
      return drag.ghost;
    }
    return this.settlingFrame?.from ?? this.removalResize?.box ?? null;
  });
  readonly frameInvalid = $derived.by(() => {
    const drag = this.current;
    if (drag?.mode === 'resize' && drag.moved) {
      return !drag.ok;
    }
    return this.removalResize?.invalid ?? false;
  });
  readonly frameRadius = $derived.by(() => {
    if (this.current?.mode === 'resize') {
      return this.current.frameRadius;
    }
    return (
      this.settlingFrame?.radius ??
      this.removalResize?.radius ??
      tileRadius(this.host.metrics().cell)
    );
  });

  private worker: DropPreviewWorker | null = null;
  private dragGeneration = 0;
  private frameGeneration = 0;

  constructor(private readonly host: DeckDragHost) {}

  begin(event: PointerEvent, item: Item, mode: Drag['mode'], corner: ResizeCorner = 'se') {
    if (event.button !== 0 || this.current || this.host.isRemoving(item.id)) {
      return;
    }
    event.stopPropagation();
    const motion = this.host.motion.nodes.get(item.id);
    const grid = this.host.grid();
    if (!motion || !grid) {
      return;
    }

    const interruptedRadius = this.settlingFrame?.id === item.id ? this.settlingFrame.radius : null;
    if (this.settlingFrame) {
      this.frameGeneration++;
      this.settlingFrame = null;
      void tick().then(() => this.resizeFrame?.cancelSettle());
    }

    const deck = this.host.deck();
    const metrics = this.host.metrics();
    const pitch = this.host.pitch();
    const pose = mode === 'move' ? readTranslation(motion) : { x: 0, y: 0 };
    const gridRect = grid.getBoundingClientRect();
    const scale = gridRect.width / grid.offsetWidth || 1;
    this.host.motion.stop(item.id);
    motion.style.translate = `${pose.x}px ${pose.y}px`;
    const capture = event.currentTarget as HTMLElement;
    capture.setPointerCapture(event.pointerId);

    const baseItem = { ...item };
    const origin = itemBox(baseItem, pitch, metrics.gap);
    const { min, max } = this.host.limits(item, corner);
    const frameRadius =
      interruptedRadius ??
      Math.min(
        tileRadius(metrics.cell),
        (Math.min(min.w, item.w) * pitch - metrics.gap) / 2,
        (Math.min(min.h, item.h) * pitch - metrics.gap) / 2,
      );
    const localX = (event.clientX - gridRect.left) / scale;
    const localY = (event.clientY - gridRect.top) / scale;
    const others = deck.items.filter((other) => other.id !== item.id);
    const cellObstacles = others.map(({ x, y, w, h }) => ({ x, y, w, h }));
    // Grown by one gap, so the live outline stops where the widget could actually end, not at the neighbour's edge.
    const pixelObstacles = others.map((other) => {
      const box = itemBox(other, pitch, metrics.gap);
      const gap = metrics.gap;
      return { x: box.x - gap, y: box.y - gap, w: box.width + 2 * gap, h: box.height + 2 * gap };
    });

    this.current = {
      id: item.id,
      item: baseItem,
      mode,
      pointerId: event.pointerId,
      capture,
      startX: event.clientX,
      startY: event.clientY,
      latest: { x: event.clientX, y: event.clientY },
      raf: null,
      grabOffsetX: localX - origin.x - pose.x,
      grabOffsetY: localY - origin.y - pose.y,
      baseX: pose.x,
      baseY: pose.y,
      screenDistance: 0,
      corner,
      scale,
      originX: gridRect.left,
      originY: gridRect.top,
      dx: 0,
      dy: 0,
      pitch,
      gap: metrics.gap,
      min,
      max,
      pixelObstacles,
      cellObstacles,
      frameRadius,
      target: baseItem,
      validResize: baseItem,
      ghost: origin,
      placement: null,
      ok: true,
      moved: false,
      moveX: pose.x,
      moveY: pose.y,
      pointerInside:
        localX >= 0 && localY >= 0 && localX < metrics.width && localY < metrics.height,
      pending: false,
      readyForRelease: false,
      generation: ++this.dragGeneration,
      requestToken: 0,
      layoutSignature: this.host.layoutSignature(),
      requestedX: null,
      requestedY: null,
      readyFrame: null,
    };
    window.addEventListener('keydown', this.keydown);
  }

  /** Coalesces pointer moves to one sample per animation frame. */
  track(event: PointerEvent, item: Item) {
    const drag = this.current;
    if (!drag || drag.id !== item.id || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.latest = { x: event.clientX, y: event.clientY };
    if (drag.raf != null) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (drag.raf === frame) {
        drag.raf = null;
      }
      if (this.current === drag) {
        this.applySample(drag, drag.latest.x, drag.latest.y);
      }
    });
    drag.raf = frame;
  }

  end(item: Item, event: PointerEvent) {
    this.flushPointer(event, item);
    const drag = this.current;
    if (!drag || drag.id !== item.id || drag.pointerId !== event.pointerId) {
      return;
    }
    if (!drag.moved) {
      this.cancel(true, event.pointerId);
      this.host.select({ item: item.id });
      return;
    }
    if (!drag.ok) {
      this.cancel(true, event.pointerId);
      return;
    }
    if (drag.mode === 'move') {
      this.endMove(drag, item, event);
    } else {
      this.endResize(drag, item, event);
    }
  }

  cancel(animate = true, pointerId?: number) {
    const drag = this.current;
    if (!drag || (pointerId != null && drag.pointerId !== pointerId)) {
      return;
    }
    const motion = this.host.motion.nodes.get(drag.id);
    const pose = motion
      ? readTranslation(motion)
      : { x: drag.baseX + drag.dx, y: drag.baseY + drag.dy };
    if (drag.mode === 'resize' && drag.moved && animate) {
      const home = itemBox(drag.item, drag.pitch, drag.gap);
      this.settleResize(drag.id, drag.ghost, home, drag.screenDistance, drag.frameRadius);
    }
    this.clear();
    releaseCapture(drag);
    if (drag.mode === 'move' && motion && animate) {
      this.host.motion.settle(drag.id, motion, pose, drag.screenDistance);
    } else {
      this.host.motion.elevated[drag.id] = false;
    }
  }

  cancelPointer = (event: PointerEvent) => {
    this.cancel(true, event.pointerId);
  };

  /** The tile is being removed: drop its gesture but keep its outline for the removal animation. */
  interruptForRemoval(id: string) {
    const drag = this.current;
    if (drag?.id === id) {
      if (drag.mode === 'move' && drag.moved) {
        this.removalMove = drag;
      }
      if (drag.mode === 'resize' && drag.moved) {
        this.removalResize = { id, box: drag.ghost, invalid: !drag.ok, radius: drag.frameRadius };
      }
      this.cancel(false);
    }
    const settling = this.settlingFrame;
    if (settling?.id === id) {
      this.removalResize = { id, box: settling.from, invalid: false, radius: settling.radius };
      this.frameGeneration++;
      this.settlingFrame = null;
      this.resizeFrame?.cancelSettle();
    }
  }

  clearRemoval(id: string) {
    if (this.removalMove?.id === id) {
      this.removalMove = null;
    }
    if (this.removalResize?.id === id) {
      this.removalResize = null;
    }
  }

  /** Smoothly returns or advances the resize outline to `target`. */
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
        if (token !== this.frameGeneration || !this.resizeFrame) {
          return;
        }
        return this.resizeFrame.settleTo(target, duration);
      })
      .then(() => {
        if (token === this.frameGeneration && this.settlingFrame?.token === token) {
          this.settlingFrame = null;
        }
      })
      .catch(() => {});
  }

  destroy() {
    this.frameGeneration++;
    const drag = this.current;
    this.clear();
    if (drag) {
      releaseCapture(drag);
    }
  }

  private keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.current) {
      return;
    }
    event.preventDefault();
    this.cancel();
  };

  private clear() {
    const drag = this.current;
    if (drag?.raf != null) {
      cancelAnimationFrame(drag.raf);
    }
    if (drag?.readyFrame != null) {
      cancelAnimationFrame(drag.readyFrame);
    }
    if (drag) {
      drag.raf = drag.readyFrame = null;
    }
    window.removeEventListener('keydown', this.keydown);
    this.current = null;
    this.worker?.cancel();
    this.worker = null;
  }

  private flushPointer(event: PointerEvent, item: Item) {
    const drag = this.current;
    if (!drag || drag.id !== item.id || drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag.raf != null) {
      cancelAnimationFrame(drag.raf);
    }
    drag.raf = null;
    drag.latest = { x: event.clientX, y: event.clientY };
    this.applySample(drag, event.clientX, event.clientY);
  }

  private applySample(drag: Drag, clientX: number, clientY: number) {
    if (this.current !== drag) {
      return;
    }
    drag.dx = (clientX - drag.startX) / drag.scale;
    drag.dy = (clientY - drag.startY) / drag.scale;
    drag.screenDistance = Math.hypot(clientX - drag.startX, clientY - drag.startY);
    drag.moved ||= Math.hypot(drag.dx, drag.dy) > DRAG_SLOP;
    if (drag.mode === 'move') {
      this.sampleMove(drag, clientX, clientY);
    } else {
      this.sampleResize(drag);
    }
  }

  private sampleMove(drag: Drag, clientX: number, clientY: number) {
    const metrics = this.host.metrics();
    const localX = (clientX - drag.originX) / drag.scale;
    const localY = (clientY - drag.originY) / drag.scale;
    drag.pointerInside =
      localX >= 0 && localY >= 0 && localX < metrics.width && localY < metrics.height;
    const projected = projectMoveOrigin(
      clientX,
      clientY,
      {
        gridLeft: drag.originX,
        gridTop: drag.originY,
        scale: drag.scale,
        pitch: drag.pitch,
        gap: drag.gap,
      },
      { x: drag.grabOffsetX, y: drag.grabOffsetY },
      drag.item,
    );
    drag.moveX = projected.translateX;
    drag.moveY = projected.translateY;
    drag.target = { ...drag.target, x: projected.x, y: projected.y };
    this.requestPlacement(drag);
  }

  /** The outline follows the pointer in pixels; the target snaps to cells with a deadband. */
  private sampleResize(drag: Drag) {
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
    if (!sameRect(target, drag.validResize)) {
      drag.validResize = target;
    }
  }

  /** Free targets preview synchronously; targets covering other tiles ask the drop worker. */
  private requestPlacement(drag: Drag) {
    const deck = this.host.deck();
    if (!drag.pointerInside || !inside(drag.target, deck)) {
      this.resetPlacement(drag);
      return;
    }
    const target = { x: drag.target.x, y: drag.target.y, w: drag.item.w, h: drag.item.h };
    const alreadyRequested = drag.requestedX === target.x && drag.requestedY === target.y;
    if (alreadyRequested && (drag.pending || drag.placement)) {
      return;
    }
    if (drag.readyFrame != null) {
      cancelAnimationFrame(drag.readyFrame);
    }
    drag.readyFrame = null;
    drag.requestedX = target.x;
    drag.requestedY = target.y;
    drag.readyForRelease = false;

    if (fits(deck.items, target, deck, [drag.id])) {
      drag.requestToken++;
      this.worker?.cancelPending();
      drag.placement = previewDrop(deck.items, drag.id, target.x, target.y, deck);
      drag.pending = false;
      drag.ok = drag.placement.kind !== 'invalid';
      this.markPreviewReady(drag);
      return;
    }

    drag.placement = null;
    drag.pending = true;
    drag.ok = true;
    const requestToken = ++drag.requestToken;
    this.worker ??= new DropPreviewWorker();
    void this.worker
      .request({
        generation: drag.generation,
        revision: drag.layoutSignature,
        id: drag.id,
        x: target.x,
        y: target.y,
        items: deck.items,
        grid: deck,
      })
      .then((reply) => {
        const current = this.current;
        const stale =
          current !== drag ||
          current.requestToken !== requestToken ||
          current.generation !== drag.generation ||
          current.layoutSignature !== this.host.layoutSignature() ||
          current.requestedX !== target.x ||
          current.requestedY !== target.y ||
          current.target.x !== target.x ||
          current.target.y !== target.y;
        if (stale) {
          return;
        }
        if (!reply) {
          current.pending = false;
          current.placement = null;
          current.readyForRelease = false;
          current.ok = false;
          current.requestedX = current.requestedY = null;
          return;
        }
        const answersThisRequest =
          reply.generation === current.generation &&
          reply.revision === current.layoutSignature &&
          reply.x === target.x &&
          reply.y === target.y;
        if (!answersThisRequest) {
          return;
        }
        current.placement = reply.preview;
        current.pending = false;
        current.readyForRelease = false;
        current.ok = reply.preview.kind !== 'invalid';
        this.markPreviewReady(current);
      });
  }

  private resetPlacement(drag: Drag) {
    drag.requestToken++;
    this.worker?.cancelPending();
    if (drag.readyFrame != null) {
      cancelAnimationFrame(drag.readyFrame);
    }
    drag.readyFrame = null;
    drag.placement = null;
    drag.pending = false;
    drag.readyForRelease = false;
    drag.ok = false;
    drag.requestedX = drag.requestedY = null;
  }

  /** A preview becomes releasable only after it has been painted for a frame. */
  private markPreviewReady(drag: Drag) {
    if (drag.readyFrame != null) {
      cancelAnimationFrame(drag.readyFrame);
    }
    drag.readyForRelease = false;
    const frame = requestAnimationFrame(() => {
      if (drag.readyFrame === frame) {
        drag.readyFrame = null;
      }
      const current = this.current;
      const stillShown =
        current === drag &&
        current.generation === drag.generation &&
        current.target.x === drag.requestedX &&
        current.target.y === drag.requestedY &&
        !!current.placement &&
        !current.pending;
      if (stillShown) {
        current.readyForRelease = true;
      }
    });
    drag.readyFrame = frame;
  }

  private endMove(drag: Drag, item: Item, event: PointerEvent) {
    const deck = this.host.deck();
    const result = drag.placement;
    const releasable =
      drag.pointerInside &&
      inside(drag.target, deck) &&
      !drag.pending &&
      drag.readyForRelease &&
      !!result &&
      drag.layoutSignature === this.host.layoutSignature() &&
      result.kind !== 'invalid' &&
      landsOnTarget(result.items, item.id, drag.target) &&
      changesLayout(result.items, deck.items);
    if (!releasable) {
      this.cancel(true, event.pointerId);
      return;
    }
    this.clear();
    this.host.write(result.items, result.displaced.length ? 'Swap widgets' : 'Move widget');
    this.host.select({ item: item.id });
  }

  private endResize(drag: Drag, item: Item, event: PointerEvent) {
    if (sameRect(drag.target, item)) {
      this.cancel(true, event.pointerId);
      return;
    }
    const deck = this.host.deck();
    const next = deck.items.map((entry) =>
      entry.id === item.id ? { ...entry, ...drag.target } : entry,
    );
    const destination = itemBox(drag.target, drag.pitch, drag.gap);
    this.settleResize(drag.id, drag.ghost, destination, drag.screenDistance, drag.frameRadius);
    this.clear();
    this.host.write(next, 'Resize widget');
    this.host.select({ item: item.id });
  }
}

function releaseCapture(drag: Drag) {
  if (drag.capture.hasPointerCapture(drag.pointerId)) {
    drag.capture.releasePointerCapture(drag.pointerId);
  }
}

function sameRect(a: CellRect, b: CellRect) {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function landsOnTarget(items: Item[], id: string, target: { x: number; y: number }) {
  const moved = items.find((entry) => entry.id === id);
  return moved?.x === target.x && moved?.y === target.y;
}

function changesLayout(next: Item[], previous: Item[]) {
  return next.some((entry) => {
    const original = previous.find((old) => old.id === entry.id)!;
    return !sameRect(entry, original);
  });
}

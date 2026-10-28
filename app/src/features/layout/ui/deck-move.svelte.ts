// Move projection and worker previews. A preview must be painted and current before release.
import { fits, inside, previewDrop, type DropPreview, type Item } from '../grid';
import { itemBox, projectMoveOrigin, sameItemRect } from '../drag-geometry';
import { DropPreviewWorker } from '../drop-worker';
import type { DeckDragHost, DragBase } from './deck-drag.svelte';

export type MoveDrag = DragBase & {
  mode: 'move';
  originX: number;
  originY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  target: Item;
  placement: DropPreview | null;
  ok: boolean;
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

export class DeckMove {
  current = $state<MoveDrag | null>(null);
  removal = $state<MoveDrag | null>(null);
  private worker: DropPreviewWorker | null = null;

  constructor(private readonly host: Pick<DeckDragHost, 'deck' | 'metrics' | 'layoutSignature'>) {}

  begin(base: DragBase, event: PointerEvent, grid: HTMLElement, generation: number) {
    const rect = grid.getBoundingClientRect();
    const metrics = this.host.metrics();
    const localX = (event.clientX - rect.left) / base.scale;
    const localY = (event.clientY - rect.top) / base.scale;
    const origin = itemBox(base.item, base.pitch, base.gap);
    this.current = {
      ...base,
      mode: 'move',
      originX: rect.left,
      originY: rect.top,
      grabOffsetX: localX - origin.x - base.baseX,
      grabOffsetY: localY - origin.y - base.baseY,
      target: base.item,
      placement: null,
      ok: true,
      moveX: base.baseX,
      moveY: base.baseY,
      pointerInside:
        localX >= 0 && localY >= 0 && localX < metrics.width && localY < metrics.height,
      pending: false,
      readyForRelease: false,
      generation,
      requestToken: 0,
      layoutSignature: this.host.layoutSignature(),
      requestedX: null,
      requestedY: null,
      readyFrame: null,
    };
    return this.current;
  }

  release(drag: MoveDrag) {
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
      landsOnTarget(result.items, drag.id, drag.target) &&
      changesLayout(result.items, deck.items);
    return releasable ? result : null;
  }

  interruptForRemoval(id: string) {
    if (this.current?.id === id && this.current.moved) {
      this.removal = this.current;
    }
  }

  clearRemoval(id: string) {
    if (this.removal?.id === id) {
      this.removal = null;
    }
  }

  clear() {
    if (this.current?.readyFrame != null) {
      cancelAnimationFrame(this.current.readyFrame);
    }
    if (this.current) {
      this.current.readyFrame = null;
    }
    this.current = null;
    this.worker?.cancel();
    this.worker = null;
  }

  destroy() {
    this.clear();
  }

  sample(drag: MoveDrag, clientX: number, clientY: number) {
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

  private requestPlacement(drag: MoveDrag) {
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

  private resetPlacement(drag: MoveDrag) {
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

  private markPreviewReady(drag: MoveDrag) {
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
}

function landsOnTarget(items: Item[], id: string, target: { x: number; y: number }) {
  const moved = items.find((entry) => entry.id === id);
  return moved?.x === target.x && moved?.y === target.y;
}

function changesLayout(next: Item[], previous: Item[]) {
  return next.some((entry) => {
    const original = previous.find((old) => old.id === entry.id)!;
    return !sameItemRect(entry, original);
  });
}

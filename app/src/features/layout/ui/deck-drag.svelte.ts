// One pointer session owns capture, frame sampling, cancellation and committing its move or resize draft.
import type { FittedDeck, Grid, Item, Selection } from '../grid';
import type { ResizeCorner } from '../drag-geometry';
import { readTranslation, type TileMotion } from './tile-motion.svelte';
import { DeckMove, type MoveDrag } from './deck-move.svelte';
import { DeckResize, type ResizeDrag } from './deck-resize.svelte';

type CellSize = { w: number; h: number };
const DRAG_SLOP = 6;

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

export type DragBase = {
  id: string;
  item: Item;
  pitch: number;
  gap: number;
  scale: number;
  baseX: number;
  baseY: number;
  dx: number;
  dy: number;
  screenDistance: number;
  moved: boolean;
};
type Session = {
  pointerId: number;
  capture: HTMLElement;
  startX: number;
  startY: number;
  latest: { x: number; y: number };
  raf: number | null;
  draft: MoveDrag | ResizeDrag;
};

export class DeckDrag {
  private session = $state<Session | null>(null);
  readonly current = $derived(this.session?.draft ?? null);
  readonly move: DeckMove;
  readonly resize: DeckResize;
  private generation = 0;

  constructor(private readonly host: DeckDragHost) {
    this.move = new DeckMove(host);
    this.resize = new DeckResize(host);
  }

  begin(event: PointerEvent, item: Item, mode: 'move' | 'resize', corner: ResizeCorner = 'se') {
    if (event.button !== 0 || this.current || this.host.isRemoving(item.id)) {
      return;
    }
    event.stopPropagation();
    const motion = this.host.motion.nodes.get(item.id);
    const grid = this.host.grid();
    if (!motion || !grid) {
      return;
    }
    const radius = this.resize.interruptSettle(item.id);
    const metrics = this.host.metrics();
    const pose = mode === 'move' ? readTranslation(motion) : { x: 0, y: 0 };
    const scale = grid.getBoundingClientRect().width / grid.offsetWidth || 1;
    this.host.motion.stop(item.id);
    motion.style.translate = `${pose.x}px ${pose.y}px`;
    const capture = event.currentTarget as HTMLElement;
    capture.setPointerCapture(event.pointerId);
    const base: DragBase = {
      id: item.id,
      item: { ...item },
      pitch: this.host.pitch(),
      gap: metrics.gap,
      scale,
      baseX: pose.x,
      baseY: pose.y,
      dx: 0,
      dy: 0,
      screenDistance: 0,
      moved: false,
    };
    const generation = ++this.generation;
    const draft =
      mode === 'move'
        ? this.move.begin(base, event, grid, generation)
        : this.resize.begin(base, corner, radius);
    this.session = {
      pointerId: event.pointerId,
      capture,
      startX: event.clientX,
      startY: event.clientY,
      latest: { x: event.clientX, y: event.clientY },
      raf: null,
      draft,
    };
    window.addEventListener('keydown', this.keydown);
  }

  track(event: PointerEvent, item: Item) {
    const session = this.matching(event, item);
    if (!session) {
      return;
    }
    session.latest = { x: event.clientX, y: event.clientY };
    if (session.raf != null) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (session.raf === frame) {
        session.raf = null;
      }
      if (this.session === session) {
        this.applySample(session, session.latest.x, session.latest.y);
      }
    });
    session.raf = frame;
  }

  end(item: Item, event: PointerEvent) {
    const session = this.matching(event, item);
    if (!session) {
      return;
    }
    if (session.raf != null) {
      cancelAnimationFrame(session.raf);
    }
    session.raf = null;
    session.latest = { x: event.clientX, y: event.clientY };
    this.applySample(session, event.clientX, event.clientY);
    const drag = session.draft;
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
      const result = this.move.release(drag);
      if (!result) {
        this.cancel(true, event.pointerId);
        return;
      }
      this.clear();
      this.host.write(result.items, result.displaced.length ? 'Swap widgets' : 'Move widget');
    } else {
      const items = this.resize.release(drag, item);
      if (!items) {
        this.cancel(true, event.pointerId);
        return;
      }
      this.clear();
      this.host.write(items, 'Resize widget');
    }
    this.host.select({ item: item.id });
  }

  cancel(animate = true, pointerId?: number) {
    const session = this.session;
    if (!session || (pointerId != null && session.pointerId !== pointerId)) {
      return;
    }
    const drag = session.draft;
    const motion = this.host.motion.nodes.get(drag.id);
    const pose = motion
      ? readTranslation(motion)
      : { x: drag.baseX + drag.dx, y: drag.baseY + drag.dy };
    if (drag.mode === 'resize') {
      this.resize.cancel(drag, animate);
    }
    this.clear();
    releaseCapture(session);
    if (drag.mode === 'move' && motion && animate) {
      this.host.motion.settle(drag.id, motion, pose, drag.screenDistance);
    } else {
      this.host.motion.elevated[drag.id] = false;
    }
  }

  cancelPointer = (event: PointerEvent) => {
    this.cancel(true, event.pointerId);
  };

  interruptForRemoval(id: string) {
    this.move.interruptForRemoval(id);
    this.resize.interruptForRemoval(id);
    if (this.current?.id === id) {
      this.cancel(false);
    }
  }

  clearRemoval(id: string) {
    this.move.clearRemoval(id);
    this.resize.clearRemoval(id);
  }

  destroy() {
    const session = this.session;
    this.clear();
    if (session) {
      releaseCapture(session);
    }
    this.resize.destroy();
  }

  private keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.current) {
      return;
    }
    event.preventDefault();
    this.cancel();
  };

  private clear() {
    if (this.session?.raf != null) {
      cancelAnimationFrame(this.session.raf);
    }
    if (this.session) {
      this.session.raf = null;
    }
    window.removeEventListener('keydown', this.keydown);
    this.session = null;
    this.move.clear();
    this.resize.current = null;
  }

  private matching(event: PointerEvent, item: Item) {
    const session = this.session;
    return session?.draft.id === item.id && session.pointerId === event.pointerId ? session : null;
  }

  private applySample(session: Session, clientX: number, clientY: number) {
    if (this.session !== session) {
      return;
    }
    const drag = session.draft;
    drag.dx = (clientX - session.startX) / drag.scale;
    drag.dy = (clientY - session.startY) / drag.scale;
    drag.screenDistance = Math.hypot(clientX - session.startX, clientY - session.startY);
    drag.moved ||= Math.hypot(drag.dx, drag.dy) > DRAG_SLOP;
    if (drag.mode === 'move') {
      this.move.sample(drag, clientX, clientY);
    } else {
      this.resize.sample(drag);
    }
  }
}

function releaseCapture(session: Session) {
  if (session.capture.hasPointerCapture(session.pointerId)) {
    session.capture.releasePointerCapture(session.pointerId);
  }
}

import { prefersReducedMotion } from 'svelte/motion';
import { sortablePosition, type SortableRect } from './position';

export type Axis = 'x' | 'y';
export type StyleSnapshot = { transform: string; transition: string; zIndex: string };

/** Pointer travel that turns a press into a drag. */
const DRAG_THRESHOLD = 4;
/** Auto-scroll: the band at a scroller's edge and the top speed in px per frame. */
const EDGE_SIZE = 44;
const EDGE_SPEED = 10;
const ACTIVE_Z_INDEX = '10';
const NEIGHBOUR_TRANSITION = 'transform 180ms cubic-bezier(.22, 1, .36, 1)';

const AXES = {
  x: {
    coordinate: 'clientX',
    origin: 'left',
    size: 'width',
    scroll: 'scrollLeft',
    clientSize: 'clientWidth',
    scrollSize: 'scrollWidth',
    gap: 'columnGap',
    overflow: 'overflowX',
  },
  y: {
    coordinate: 'clientY',
    origin: 'top',
    size: 'height',
    scroll: 'scrollTop',
    clientSize: 'clientHeight',
    scrollSize: 'scrollHeight',
    gap: 'rowGap',
    overflow: 'overflowY',
  },
} as const;

function setOrClear(item: HTMLElement, property: string, value: string) {
  if (value) {
    item.style.setProperty(property, value);
  } else {
    item.style.removeProperty(property);
  }
}

export function restoreStyle(item: HTMLElement, style: StyleSnapshot) {
  setOrClear(item, 'transform', style.transform);
  setOrClear(item, 'transition', style.transition);
  setOrClear(item, 'z-index', style.zIndex);
}

function setTranslate(item: HTMLElement, axis: Axis, value: number) {
  item.style.transform = value ? `translate${axis.toUpperCase()}(${value}px)` : '';
}

function scrollParent(node: HTMLElement, axis: Axis) {
  const props = AXES[axis];
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent)[props.overflow];
    if (
      (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') &&
      parent[props.scrollSize] > parent[props.clientSize] + 1
    ) {
      return parent;
    }
  }
  return undefined;
}

/**
 * One press-to-release drag. The axis, scroll parent, item bounds, gap and reduced-motion setting are read once at
 * press: layout does not change while items only translate.
 */
export class SortSession {
  destination: number;
  moved = false;
  frame: number | null = null;
  readonly pointerId: number;
  readonly source: HTMLElement;
  readonly styles: Map<HTMLElement, StyleSnapshot>;
  readonly reducedMotion = prefersReducedMotion.current;
  private readonly props;
  private readonly scrollElement?: HTMLElement;
  private readonly scrollRect?: DOMRect;
  private readonly scrollEnd: number;
  private readonly startScroll: number;
  private readonly bounds: SortableRect[];
  private readonly gap: number;
  private readonly start: number;
  private latest: number;

  constructor(
    private readonly node: HTMLElement,
    readonly axis: Axis,
    readonly items: HTMLElement[],
    readonly from: number,
    event: PointerEvent,
  ) {
    const props = AXES[axis];
    this.props = props;
    this.pointerId = event.pointerId;
    this.destination = from;
    this.source = items[from];
    this.scrollElement = scrollParent(node, axis);
    this.scrollRect = this.scrollElement?.getBoundingClientRect();
    this.startScroll = this.scrollElement?.[props.scroll] ?? 0;
    this.scrollEnd = this.scrollElement
      ? this.scrollElement[props.scrollSize] - this.scrollElement[props.clientSize]
      : 0;
    this.bounds = items.map((item) => {
      const rect = item.getBoundingClientRect();
      const start = rect[props.origin] + this.startScroll;
      return { start, end: start + rect[props.size] };
    });
    this.start = this.latest = event[props.coordinate];
    this.gap = this.readGap();
    this.styles = new Map(
      items.map((item) => [
        item,
        {
          transform: item.style.transform,
          transition: item.style.transition,
          zIndex: item.style.zIndex,
        },
      ]),
    );
  }

  /** The CSS gap, or the measured space beside the dragged item when the container sets none. */
  private readGap() {
    const computed = Number.parseFloat(getComputedStyle(this.node)[this.props.gap]);
    if (Number.isFinite(computed)) {
      return computed;
    }
    const { bounds, from } = this;
    if (from < bounds.length - 1) {
      return Math.max(0, bounds[from + 1].start - bounds[from].end);
    }
    return from > 0 ? Math.max(0, bounds[from].start - bounds[from - 1].end) : 0;
  }

  private scrollDelta() {
    return (this.scrollElement?.[this.props.scroll] ?? this.startScroll) - this.startScroll;
  }

  capture() {
    try {
      this.source.setPointerCapture(this.pointerId);
    } catch {
      /* Window capture listeners still complete the pointer session. */
    }
  }

  releaseCapture() {
    if (this.source.hasPointerCapture(this.pointerId)) {
      this.source.releasePointerCapture(this.pointerId);
    }
  }

  follow(event: PointerEvent) {
    this.latest = event[this.props.coordinate];
  }

  /** Whether the drag has started; once true it stays true. */
  checkMoved() {
    this.moved ||= Math.abs(this.latest - this.start + this.scrollDelta()) >= DRAG_THRESHOLD;
    return this.moved;
  }

  /** Position the dragged item under the pointer and shift its neighbours aside. */
  paint() {
    const { items, from, axis } = this;
    const position = sortablePosition(
      from,
      this.latest - this.start + this.scrollDelta(),
      this.bounds,
    );
    this.destination = position.destination;
    const step = this.bounds[from].end - this.bounds[from].start + this.gap;
    const source = this.source;
    source.style.transition = 'none';
    source.style.zIndex = ACTIVE_Z_INDEX;
    source.setAttribute('data-sortable-active', '');
    setTranslate(source, axis, position.translation);
    items.forEach((item, index) => {
      if (index === from) {
        return;
      }
      let shift = 0;
      if (index > from && index <= this.destination) {
        shift = -step;
      } else if (index < from && index >= this.destination) {
        shift = step;
      }
      item.style.transition = this.reducedMotion ? 'none' : NEIGHBOUR_TRANSITION;
      setTranslate(item, axis, shift);
    });
  }

  /** Scroll the container when the pointer is near its edge. Returns whether it moved. */
  edgeScroll() {
    const { scrollElement, scrollRect, props } = this;
    if (!this.moved || !scrollElement || !scrollRect) {
      return false;
    }
    const startPoint = scrollRect[props.origin];
    const size = scrollRect[props.size];
    const edgeSize = Math.min(EDGE_SIZE, size / 4);
    if (edgeSize <= 0) {
      return false;
    }
    const before = this.latest - startPoint;
    const after = startPoint + size - this.latest;
    let delta = 0;
    if (before < edgeSize) {
      delta = -Math.ceil((EDGE_SPEED * (edgeSize - before)) / edgeSize);
    } else if (after < edgeSize) {
      delta = Math.ceil((EDGE_SPEED * (edgeSize - after)) / edgeSize);
    }
    if (!delta) {
      return false;
    }
    const old = scrollElement[props.scroll];
    scrollElement[props.scroll] = Math.max(0, Math.min(this.scrollEnd, old + delta));
    return scrollElement[props.scroll] !== old;
  }

  /**
   * Drop the drag offsets without letting any CSS transition animate them back; transitions return a frame later,
   * except for items `keepTransition` still claims when that frame arrives.
   */
  restore(keepTransition: (item: HTMLElement) => boolean) {
    for (const [item, style] of this.styles) {
      item.style.transition = 'none';
      setOrClear(item, 'transform', style.transform);
      setOrClear(item, 'z-index', style.zIndex);
      item.removeAttribute('data-sortable-active');
    }
    void this.node.offsetHeight;
    const finish = () => {
      cancelAnimationFrame(frame);
      for (const [item, style] of this.styles) {
        if (!keepTransition(item)) {
          setOrClear(item, 'transition', style.transition);
        }
      }
    };
    const frame = requestAnimationFrame(finish);
    this.node.removeAttribute('data-sorting');
    return finish;
  }
}

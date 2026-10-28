import { tick } from 'svelte';
import { SPRING_SAMPLES } from '../spring';
import { sortablePosition, type SortableRect } from './position';

export type SortableOptions = {
  axis: 'x' | 'y';
  items: () => HTMLElement[];
  handle?: string;
  enabled?: boolean;
  onmove: (from: number, to: number) => void;
};

type StyleSnapshot = { transform: string; transition: string; zIndex: string };
type Session = {
  pointerId: number;
  from: number;
  destination: number;
  start: number;
  latest: number;
  startScroll: number;
  scrollElement?: HTMLElement;
  scrollStart: number;
  scrollEnd: number;
  scrollRect?: DOMRect;
  bounds: SortableRect[];
  items: HTMLElement[];
  source: HTMLElement;
  moved: boolean;
  frame: number | null;
  styles: Map<HTMLElement, StyleSnapshot>;
};

const axisProperty = (axis: 'x' | 'y') =>
  axis === 'x'
    ? {
        coordinate: 'clientX' as const,
        size: 'width' as const,
        scroll: 'scrollLeft' as const,
        clientSize: 'clientWidth' as const,
        scrollSize: 'scrollWidth' as const,
        gap: 'columnGap' as const,
      }
    : {
        coordinate: 'clientY' as const,
        size: 'height' as const,
        scroll: 'scrollTop' as const,
        clientSize: 'clientHeight' as const,
        scrollSize: 'scrollHeight' as const,
        gap: 'rowGap' as const,
      };

function scrollParent(node: HTMLElement, axis: 'x' | 'y') {
  const props = axisProperty(axis);
  for (let parent = node; parent; parent = parent.parentElement!) {
    const style = getComputedStyle(parent);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    if (
      (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') &&
      parent[props.scrollSize] > parent[props.clientSize] + 1
    )
      return parent;
  }
  return undefined;
}

/** Shared pointer sorter: capture on press, start after 4px, move on one axis, shift neighbours at their midpoint, then call onmove(from,to) once. */
export function sortable(node: HTMLElement, initial: SortableOptions) {
  let options = initial;
  let session: Session | null = null;
  let suppressedClick: HTMLElement | null = null;
  let suppressClickUntil = 0;
  let settleFrame: number | null = null;
  let settleAnimation: Animation | null = null;
  let settlingStyle: { item: HTMLElement; style: StyleSnapshot } | null = null;
  const priorSortableRoot = node.getAttribute('data-sortable-root');
  node.setAttribute('data-sortable-root', '');

  function matchesItems(current: Session) {
    const items = options.items();
    return (
      items.length === current.items.length &&
      items.every((item, index) => item === current.items[index])
    );
  }

  function restore(current: Session) {
    // Drop the drag offsets without letting any CSS transition animate them back; transitions return a frame later.
    for (const [item, style] of current.styles) {
      item.style.transition = 'none';
      if (style.transform) item.style.transform = style.transform;
      else item.style.removeProperty('transform');
      if (style.zIndex) item.style.zIndex = style.zIndex;
      else item.style.removeProperty('z-index');
      item.removeAttribute('data-sortable-active');
    }
    void node.offsetHeight;
    requestAnimationFrame(() => {
      for (const [item, style] of current.styles) {
        if (settlingStyle?.item === item) continue;
        if (style.transition) item.style.transition = style.transition;
        else item.style.removeProperty('transition');
      }
    });
    node.removeAttribute('data-sorting');
  }

  function restoreStyle(item: HTMLElement, style: StyleSnapshot) {
    if (style.transform) item.style.transform = style.transform;
    else item.style.removeProperty('transform');
    if (style.transition) item.style.transition = style.transition;
    else item.style.removeProperty('transition');
    if (style.zIndex) item.style.zIndex = style.zIndex;
    else item.style.removeProperty('z-index');
  }

  function cancelSettlement() {
    settleFrame = null;
    const animation = settleAnimation;
    settleAnimation = null;
    animation?.cancel();
    if (settlingStyle) restoreStyle(settlingStyle.item, settlingStyle.style);
    settlingStyle = null;
  }

  function cancel(current = session) {
    if (!current || session !== current) return;
    session = null;
    stopSessionListeners();
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    restore(current);
    if (current.source.hasPointerCapture(current.pointerId))
      current.source.releasePointerCapture(current.pointerId);
  }

  function stopSessionListeners() {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerCancel, true);
    window.removeEventListener('pointerdown', onNewPointerDown, true);
  }

  function startSessionListeners() {
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('pointerdown', onNewPointerDown, true);
  }

  function contentBounds(items: HTMLElement[], axis: 'x' | 'y', scrollElement?: HTMLElement) {
    const props = axisProperty(axis);
    const offset = scrollElement?.[props.scroll] ?? 0;
    return items.map((item) => {
      const rect = item.getBoundingClientRect();
      const start = (axis === 'x' ? rect.left : rect.top) + offset;
      return { start, end: start + rect[props.size] };
    });
  }

  function setTranslate(item: HTMLElement, axis: 'x' | 'y', value: number) {
    item.style.transform = value ? `translate${axis.toUpperCase()}(${value}px)` : '';
  }

  function paint(current: Session) {
    if (session !== current) return;
    if (!matchesItems(current) || options.enabled === false) {
      cancel(current);
      return;
    }
    const props = axisProperty(options.axis);
    const scrollDelta =
      (current.scrollElement?.[props.scroll] ?? current.startScroll) - current.startScroll;
    const position = sortablePosition(
      current.from,
      current.latest - current.start + scrollDelta,
      current.bounds,
    );
    current.destination = position.destination;
    const sourceSize = current.bounds[current.from].end - current.bounds[current.from].start;
    const computedGap = Number.parseFloat(getComputedStyle(node)[props.gap]);
    const neighborGap =
      current.from < current.bounds.length - 1
        ? current.bounds[current.from + 1].start - current.bounds[current.from].end
        : current.from > 0
          ? current.bounds[current.from].start - current.bounds[current.from - 1].end
          : 0;
    const gap = Number.isFinite(computedGap) ? computedGap : Math.max(0, neighborGap);
    const step = sourceSize + gap;
    const source = current.items[current.from];

    source.style.transition = 'none';
    source.style.zIndex = '10';
    source.setAttribute('data-sortable-active', '');
    setTranslate(source, options.axis, position.translation);
    current.items.forEach((item, index) => {
      if (index === current.from) return;
      const shift =
        index > current.from && index <= current.destination
          ? -step
          : index < current.from && index >= current.destination
            ? step
            : 0;
      item.style.transition = matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'none'
        : 'transform 180ms cubic-bezier(.22, 1, .36, 1)';
      setTranslate(item, options.axis, shift);
    });
  }

  function settleSource(current: Session, heldRects: Map<HTMLElement, DOMRect>) {
    // Runs after the caller's reorder has flushed (microtask after Svelte's), before the next paint: no visible jump.
    settleFrame = 1;
    void tick().then(() => {
      if (settleFrame === null) return;
      settleFrame = null;
      const source = current.source,
        original = current.styles.get(source);
      if (!source.isConnected || !original) return;
      const held = heldRects.get(source);
      if (!held) return;
      const rect = source.getBoundingClientRect();
      const heldStart = options.axis === 'x' ? held.left : held.top;
      const finalStart = options.axis === 'x' ? rect.left : rect.top;
      const offset = heldStart - finalStart;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(offset) < 0.5) return;
      const axis = options.axis === 'x' ? 'X' : 'Y';
      const from = `translate${axis}(${offset}px)${original.transform ? ` ${original.transform}` : ''}`;
      const to = original.transform || 'none';
      settlingStyle = { item: source, style: original };
      source.style.transition = 'none';
      source.style.transform = from;
      void source.getBoundingClientRect();
      const distanceDuration = Math.max(160, Math.min(260, 160 + Math.abs(offset) * 0.2));
      const animation = source.animate(
        [
          { transform: from, offset: 0 },
          ...SPRING_SAMPLES.slice(1).map((sample) => ({
            transform: `translate${axis}(${offset * (1 - sample.progress)}px)${original.transform ? ` ${original.transform}` : ''}`,
            offset: sample.offset,
          })),
          { transform: to, offset: 1 },
        ],
        { duration: distanceDuration, fill: 'both' },
      );
      settleAnimation = animation;
      void animation.finished
        .then(() => {
          if (settleAnimation !== animation) return;
          settleAnimation = null;
          if (settlingStyle?.item === source) {
            restoreStyle(source, original);
            settlingStyle = null;
          }
          animation.cancel();
        })
        .catch(() => {});
    });
  }

  function edgeScroll(current: Session) {
    if (!current.moved || !current.scrollElement || !current.scrollRect) return false;
    const props = axisProperty(options.axis);
    const startPoint = options.axis === 'x' ? current.scrollRect.left : current.scrollRect.top;
    const size = current.scrollRect[props.size];
    const coordinate = current.latest;
    const edgeSize = Math.min(44, size / 4);
    if (edgeSize <= 0) return false;
    const before = coordinate - startPoint;
    const after = startPoint + size - coordinate;
    let delta = 0;
    if (before < edgeSize) delta = -Math.ceil((10 * (edgeSize - before)) / edgeSize);
    else if (after < edgeSize) delta = Math.ceil((10 * (edgeSize - after)) / edgeSize);
    if (!delta) return false;
    const old = current.scrollElement[props.scroll];
    current.scrollElement[props.scroll] = Math.max(
      current.scrollStart,
      Math.min(current.scrollEnd, old + delta),
    );
    return current.scrollElement[props.scroll] !== old;
  }

  function schedulePaint(current: Session) {
    if (current.frame !== null) return;
    current.frame = requestAnimationFrame(() => {
      current.frame = null;
      if (session !== current) return;
      const scrolled = edgeScroll(current);
      paint(current);
      if (scrolled) schedulePaint(current);
    });
  }

  function onPointerDown(event: PointerEvent) {
    const target = event.target;
    if (session) cancel(session);
    if (
      options.enabled === false ||
      event.button !== 0 ||
      !(target instanceof Element) ||
      target.closest('[data-sortable-root]') !== node
    )
      return;
    suppressedClick = null;
    cancelSettlement();
    const items = options.items();
    if (items.length < 2) return;
    const source = items.find((item) => item === target || item.contains(target));
    if (!source) return;
    if (options.handle) {
      const handle = target.closest(options.handle);
      if (!handle || !source.contains(handle)) return;
    }
    for (const item of items) for (const animation of item.getAnimations()) animation.cancel();
    const parent = scrollParent(node, options.axis);
    const props = axisProperty(options.axis);
    const bounds = contentBounds(items, options.axis, parent);
    const from = items.indexOf(source);
    if (from < 0) return;
    const styles = new Map(
      items.map((item) => [
        item,
        {
          transform: item.style.transform,
          transition: item.style.transition,
          zIndex: item.style.zIndex,
        },
      ]),
    );
    session = {
      pointerId: event.pointerId,
      from,
      destination: from,
      start: event[props.coordinate],
      latest: event[props.coordinate],
      startScroll: parent?.[props.scroll] ?? 0,
      scrollStart: 0,
      scrollEnd: parent ? parent[props.scrollSize] - parent[props.clientSize] : 0,
      scrollElement: parent,
      scrollRect: parent?.getBoundingClientRect(),
      bounds,
      items,
      source,
      moved: false,
      frame: null,
      styles,
    };
    startSessionListeners();
    try {
      source.setPointerCapture(event.pointerId);
    } catch {
      /* Window capture listeners still complete the pointer session. */
    }
  }

  function onNewPointerDown() {
    if (session) cancel(session);
  }

  function onPointerMove(event: PointerEvent) {
    const current = session;
    if (!current || current.pointerId !== event.pointerId) return;
    current.latest = event[axisProperty(options.axis).coordinate];
    const scrollDelta =
      (current.scrollElement?.[axisProperty(options.axis).scroll] ?? current.startScroll) -
      current.startScroll;
    current.moved ||= Math.abs(current.latest - current.start + scrollDelta) >= 4;
    if (!current.moved) return;
    if (event.cancelable) event.preventDefault();
    node.setAttribute('data-sorting', '');
    schedulePaint(current);
  }

  function onPointerUp(event: PointerEvent) {
    const current = session;
    if (!current || current.pointerId !== event.pointerId) return;
    current.latest = event[axisProperty(options.axis).coordinate];
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    current.frame = null;
    if (current.moved) paint(current);
    const from = current.from,
      to = current.destination;
    const validOrder = matchesItems(current) && options.enabled !== false;
    const shouldMove = current.moved && validOrder && to !== from;
    const heldRects =
      current.moved && validOrder
        ? new Map(current.items.map((item) => [item, item.getBoundingClientRect()]))
        : null;
    session = null;
    stopSessionListeners();
    restore(current);
    if (current.source.hasPointerCapture(current.pointerId))
      current.source.releasePointerCapture(current.pointerId);
    if (current.moved) {
      suppressedClick = current.source;
      suppressClickUntil = performance.now() + 500;
    }
    if (shouldMove) options.onmove(from, to);
    if (heldRects) settleSource(current, heldRects);
  }

  function onPointerCancel(event: PointerEvent) {
    if (session?.pointerId === event.pointerId) cancel();
  }

  function onLostCapture(event: PointerEvent) {
    if (session?.pointerId === event.pointerId) cancel();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !session) return;
    event.preventDefault();
    cancel();
  }

  function onBlur() {
    cancel();
  }

  function onClick(event: MouseEvent) {
    if (!suppressedClick) return;
    const target = event.target;
    const shouldSuppress =
      performance.now() < suppressClickUntil &&
      target instanceof Node &&
      (target === suppressedClick || suppressedClick.contains(target));
    suppressedClick = null;
    if (!shouldSuppress) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('lostpointercapture', onLostCapture);
  node.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', onBlur);

  return {
    update(next: SortableOptions) {
      options = next;
      if (options.enabled === false) cancel();
    },
    destroy() {
      cancel();
      cancelSettlement();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('lostpointercapture', onLostCapture);
      node.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
      if (priorSortableRoot === null) node.removeAttribute('data-sortable-root');
      else node.setAttribute('data-sortable-root', priorSortableRoot);
    },
  };
}

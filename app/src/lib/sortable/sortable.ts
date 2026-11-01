import { SortSession, type Axis } from './session';
import { DropSettlement } from './settle';

export type SortableOptions = {
  axis: Axis;
  items: () => HTMLElement[];
  handle?: string;
  enabled?: boolean;
  onmove: (from: number, to: number) => void;
  /** Elements outside the list that take a dropped item: they light up while dragging and replace onmove on release. */
  drop?: {
    selector: string;
    accept: (zone: HTMLElement) => boolean;
    ondrop: (from: number, zone: HTMLElement) => void;
  };
};

/** A drag swallows the click that follows its release, for this long. */
const CLICK_SUPPRESS_MS = 500;

/** Shared pointer sorter: capture on press, start after 4px, move on one axis, shift neighbours at their midpoint, then call onmove(from,to) once. */
export function sortable(node: HTMLElement, initial: SortableOptions) {
  let options = initial;
  let session: SortSession | null = null;
  let suppressed: { item: HTMLElement; until: number } | null = null;
  const settlement = new DropSettlement();
  let restoreTransitions: (() => void) | undefined;
  let zones: HTMLElement[] = [];
  let over: HTMLElement | null = null;
  let sessionListeners: AbortController | undefined;
  const nodeListeners = new AbortController();
  node.setAttribute('data-sortable-root', '');

  /** The rendered items are still the ones the session started with, and sorting is still on. */
  function valid(current: SortSession) {
    const items = options.items();
    return (
      options.enabled !== false &&
      items.length === current.items.length &&
      items.every((item, index) => item === current.items[index])
    );
  }

  /** Drops any previous drop animation and the transitions it suppressed. */
  function reset() {
    settlement.cancel();
    restoreTransitions?.();
    restoreTransitions = undefined;
  }

  function cancel() {
    const current = session;
    if (!current) {
      return;
    }
    session = null;
    sessionListeners?.abort();
    end(current);
  }

  function markZones(current: SortSession) {
    const { drop } = options;
    if (!drop || zones.length) {
      return;
    }
    zones = [...document.querySelectorAll<HTMLElement>(drop.selector)].filter(
      (zone) => !current.source.contains(zone) && drop.accept(zone),
    );
    for (const zone of zones) {
      zone.setAttribute('data-drop-ready', '');
    }
  }

  function hover(event: PointerEvent) {
    const next =
      document
        .elementsFromPoint(event.clientX, event.clientY)
        .find((element) => zones.includes(element as HTMLElement)) ?? null;
    if (next !== over) {
      over?.removeAttribute('data-drop-over');
      next?.setAttribute('data-drop-over', '');
      over = next as HTMLElement | null;
    }
  }

  function clearZones() {
    for (const zone of zones) {
      zone.removeAttribute('data-drop-ready');
      zone.removeAttribute('data-drop-over');
    }
    zones = [];
    over = null;
  }

  /** Stops the session's frame, resets its styles and gives up pointer capture. */
  function end(current: SortSession) {
    clearZones();
    if (current.frame !== null) {
      cancelAnimationFrame(current.frame);
      current.frame = null;
    }
    restoreTransitions = current.restore((item) => settlement.item === item);
    current.releaseCapture();
  }

  function startSessionListeners() {
    const { signal } = (sessionListeners = new AbortController());
    window.addEventListener('pointermove', onPointerMove, {
      capture: true,
      passive: false,
      signal,
    });
    window.addEventListener('pointerup', onPointerUp, { capture: true, signal });
    window.addEventListener('pointercancel', onPointerCancel, { capture: true, signal });
    window.addEventListener('pointerdown', cancel, { capture: true, signal });
    window.addEventListener('keydown', onKeyDown, { signal });
    window.addEventListener('blur', cancel, { signal });
  }

  function paint(current: SortSession) {
    if (session !== current) {
      return;
    }
    if (!valid(current)) {
      cancel();
      return;
    }
    current.paint();
  }

  function schedulePaint(current: SortSession) {
    if (current.frame !== null) {
      return;
    }
    current.frame = requestAnimationFrame(() => {
      current.frame = null;
      if (session !== current) {
        return;
      }
      const scrolled = current.edgeScroll();
      paint(current);
      if (scrolled) {
        schedulePaint(current);
      }
    });
  }

  function onPointerDown(event: PointerEvent) {
    const target = event.target;
    cancel();
    if (
      options.enabled === false ||
      event.button !== 0 ||
      !(target instanceof Element) ||
      target.closest('[data-sortable-root]') !== node
    ) {
      return;
    }
    suppressed = null;
    reset();
    const items = options.items();
    if (items.length < 2 && !options.drop) {
      return;
    }
    const source = items.find((item) => item === target || item.contains(target));
    if (!source) {
      return;
    }
    if (options.handle) {
      const handle = target.closest(options.handle);
      if (!handle || !source.contains(handle)) {
        return;
      }
    }
    for (const item of items) {
      for (const animation of item.getAnimations()) {
        animation.cancel();
      }
    }
    session = new SortSession(
      node,
      options.axis,
      items,
      items.indexOf(source),
      event,
      !!options.drop,
    );
    startSessionListeners();
    session.capture();
  }

  function onPointerMove(event: PointerEvent) {
    const current = session;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    current.follow(event);
    if (!current.checkMoved()) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    node.setAttribute('data-sorting', '');
    markZones(current);
    hover(event);
    schedulePaint(current);
  }

  function onPointerUp(event: PointerEvent) {
    const current = session;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    current.follow(event);
    const commit = current.moved && valid(current);
    if (commit) {
      current.paint();
    }
    const { from, destination } = current;
    const zone = commit ? over : null;
    // Measured while still displaced, so the settle can start from where the item was dropped.
    const held = commit && !zone ? current.source.getBoundingClientRect() : null;
    session = null;
    sessionListeners?.abort();
    end(current);
    if (current.moved) {
      suppressed = { item: current.source, until: performance.now() + CLICK_SUPPRESS_MS };
    }
    if (zone) {
      options.drop?.ondrop(from, zone);
    } else if (commit && destination !== from) {
      options.onmove(from, destination);
    }
    if (held) {
      settlement.play(current, held);
    }
  }

  function onPointerCancel(event: PointerEvent) {
    if (session?.pointerId === event.pointerId) {
      cancel();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  function onClick(event: MouseEvent) {
    if (!suppressed) {
      return;
    }
    const { item, until } = suppressed;
    suppressed = null;
    const target = event.target;
    if (performance.now() < until && target instanceof Node && item.contains(target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  const { signal } = nodeListeners;
  node.addEventListener('pointerdown', onPointerDown, { signal });
  node.addEventListener('lostpointercapture', onPointerCancel, { signal });
  node.addEventListener('click', onClick, { capture: true, signal });

  return {
    update(next: SortableOptions) {
      options = next;
      if (options.enabled === false) {
        cancel();
      }
    },
    destroy() {
      cancel();
      reset();
      nodeListeners.abort();
      node.removeAttribute('data-sortable-root');
    },
  };
}

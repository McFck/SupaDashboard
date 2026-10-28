import { SortSession, type Axis } from './session';
import { DropSettlement } from './settle';

export type SortableOptions = {
  axis: Axis;
  items: () => HTMLElement[];
  handle?: string;
  enabled?: boolean;
  onmove: (from: number, to: number) => void;
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
  const priorSortableRoot = node.getAttribute('data-sortable-root');
  node.setAttribute('data-sortable-root', '');

  function matchesItems(current: SortSession) {
    const items = options.items();
    return (
      items.length === current.items.length &&
      items.every((item, index) => item === current.items[index])
    );
  }

  function cancel() {
    const current = session;
    if (!current) {
      return;
    }
    session = null;
    stopSessionListeners();
    end(current);
  }

  /** Stops the session's frame, resets its styles and gives up pointer capture. */
  function end(current: SortSession) {
    if (current.frame !== null) {
      cancelAnimationFrame(current.frame);
      current.frame = null;
    }
    restoreTransitions = current.restore((item) => settlement.item === item);
    current.releaseCapture();
  }

  function startSessionListeners() {
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', cancel);
  }

  function stopSessionListeners() {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerCancel, true);
    window.removeEventListener('pointerdown', cancel, true);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('blur', cancel);
  }

  function paint(current: SortSession) {
    if (session !== current) {
      return;
    }
    if (!matchesItems(current) || options.enabled === false) {
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
    settlement.cancel();
    restoreTransitions?.();
    restoreTransitions = undefined;
    const items = options.items();
    if (items.length < 2) {
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
    session = new SortSession(node, options.axis, items, items.indexOf(source), event);
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
    schedulePaint(current);
  }

  function onPointerUp(event: PointerEvent) {
    const current = session;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    current.follow(event);
    if (current.frame !== null) {
      cancelAnimationFrame(current.frame);
      current.frame = null;
    }
    if (current.moved) {
      paint(current);
    }
    const { from, destination } = current;
    const validOrder = matchesItems(current) && options.enabled !== false;
    // Measured while still displaced, so the settle can start from where the item was dropped.
    const held = current.moved && validOrder ? current.source.getBoundingClientRect() : null;
    session = null;
    stopSessionListeners();
    end(current);
    if (current.moved) {
      suppressed = { item: current.source, until: performance.now() + CLICK_SUPPRESS_MS };
    }
    if (current.moved && validOrder && destination !== from) {
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

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('lostpointercapture', onPointerCancel);
  node.addEventListener('click', onClick, true);

  return {
    update(next: SortableOptions) {
      options = next;
      if (options.enabled === false) {
        cancel();
      }
    },
    destroy() {
      cancel();
      settlement.cancel();
      restoreTransitions?.();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('lostpointercapture', onPointerCancel);
      node.removeEventListener('click', onClick, true);
      if (priorSortableRoot === null) {
        node.removeAttribute('data-sortable-root');
      } else {
        node.setAttribute('data-sortable-root', priorSortableRoot);
      }
    },
  };
}

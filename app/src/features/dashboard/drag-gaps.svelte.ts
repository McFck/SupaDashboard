// The transparent dashboard is dragged by its empty areas. This measures them: the shell minus every widget,
// control and chrome element, recomputed whenever any of those moves or resizes.
import { complementRectangles, type LocalRect } from '../display/display';

const INTERACTIVE =
  '[data-skin-input], .tile, button, input, select, textarea, a, [contenteditable], [role="slider"]';
const CHROME = '.dashboard-page-dots, .dashboard-page-dots button, [data-resize-handle]';
const OBSERVED_ATTRIBUTES = [
  'data-visible-page',
  'data-skin-input',
  'aria-hidden',
  'inert',
  'style',
];

export class DragGaps {
  rects = $state<LocalRect[]>([]);
  private frame = 0;
  private readonly resizeObserver: ResizeObserver;
  private readonly mutationObserver: MutationObserver;
  private observed = new Set<Element>();
  private destroyed = false;

  constructor(
    private readonly shell: HTMLElement,
    private readonly pageHost: HTMLElement,
    /** While pages slide, the gaps would be stale; none are offered. */
    private readonly busy: () => boolean,
  ) {
    this.resizeObserver = new ResizeObserver(() => this.schedule());
    this.resizeObserver.observe(shell);
    this.mutationObserver = new MutationObserver(() => {
      this.observeNodes();
      this.schedule();
    });
    this.mutationObserver.observe(pageHost, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
    });
    this.observeNodes();
    this.schedule();
  }

  /** Measures on the next animation frame; repeated calls in one frame measure once. */
  schedule() {
    if (this.frame || this.destroyed) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  /** Watches the visible page's interactive elements, which can resize without a DOM mutation. */
  observeNodes() {
    if (this.destroyed) {
      return;
    }
    const skinRoot = this.visibleSkinRoot();
    const next = new Set<Element>([
      ...(skinRoot ? [skinRoot] : []),
      ...this.shell.querySelectorAll(CHROME),
    ]);
    skinRoot
      ?.querySelectorAll(`[data-dashboard-tile], ${INTERACTIVE}`)
      .forEach((node) => next.add(node));
    for (const node of this.observed) {
      if (!next.has(node)) {
        this.resizeObserver.unobserve(node);
      }
    }
    for (const node of next) {
      if (!this.observed.has(node)) {
        this.resizeObserver.observe(node);
      }
    }
    this.observed = next;
  }

  destroy() {
    this.destroyed = true;
    if (this.frame) {
      cancelAnimationFrame(this.frame);
    }
    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    this.observed.clear();
  }

  private visibleSkinRoot() {
    return this.pageHost.querySelector<HTMLElement>('[data-visible-page="true"]');
  }

  private measure() {
    const skinRoot = this.visibleSkinRoot();
    if (!skinRoot || this.busy()) {
      this.rects = [];
      return;
    }
    const surface = this.shell.getBoundingClientRect();
    const excluded: LocalRect[] = [];
    const exclude = (node: Element) => {
      const rect = visibleRect(node, skinRoot, surface);
      if (rect && !excluded.some((outer) => contains(outer, rect))) {
        excluded.push(rect);
      }
    };
    skinRoot.querySelectorAll('[data-dashboard-tile]').forEach(exclude);
    skinRoot.querySelectorAll(INTERACTIVE).forEach(exclude);
    this.shell
      .querySelectorAll('.dashboard-page-dots, .dashboard-page-dots button')
      .forEach(exclude);
    this.shell.querySelectorAll('[data-resize-handle]').forEach(exclude);
    this.rects = complementRectangles(
      surface.width,
      surface.height,
      excluded,
      window.devicePixelRatio || 1,
    );
  }
}

/** The node's box relative to the shell, or null when it is hidden and takes no input. */
function visibleRect(node: Element, skinRoot: HTMLElement, surface: DOMRect): LocalRect | null {
  if (node.closest('[data-skin-input="ui"][aria-hidden="true"]')) {
    return null;
  }
  // Opening overlays start their opacity transition at zero; their logical state already owns pointer input.
  const skinSurface = node.matches(
    '[data-skin-input="scene"], [data-skin-input="slot"], [data-skin-input="ui"][aria-hidden="false"]',
  );
  for (
    let current: Element | null = node;
    current && current !== skinRoot.parentElement;
    current = current.parentElement
  ) {
    const style = getComputedStyle(current);
    const transparent = !skinSurface && Number(style.opacity) === 0;
    if (style.display === 'none' || style.visibility === 'hidden' || transparent) {
      return null;
    }
  }
  const bounds = node.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }
  return {
    x: bounds.left - surface.left,
    y: bounds.top - surface.top,
    width: bounds.width,
    height: bounds.height,
  };
}

function contains(outer: LocalRect, inner: LocalRect) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// FLIP for the step editor: cards jump to their new place on an edit, then slide there from the old one.
import { tick } from 'svelte';
import { prefersReducedMotion } from 'svelte/motion';

/** The nearest scrolling ancestor; the picker placement and FLIP measure against it. */
export function scrollParent(node: HTMLElement) {
  let parent = node.parentElement;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
    parent = parent.parentElement;
  }
  return parent ?? document.documentElement;
}

export class StepLayoutMotion {
  private readonly animations = new Map<HTMLElement, Animation>();

  /** Runs `change` and animates every step card of the tab panel from its old position. */
  async change(list: HTMLElement | undefined, change: () => void) {
    const cards = [
      ...(list?.closest('[role="tabpanel"]')?.querySelectorAll<HTMLElement>('[data-step-row]') ??
        []),
    ];
    const scroll = list ? scrollParent(list) : undefined;
    const before = cards.map((node) => ({
      node,
      y: node.getBoundingClientRect().top + (scroll?.scrollTop ?? 0),
    }));
    for (const node of cards) {
      this.animations.get(node)?.cancel();
    }
    change();
    await tick();
    if (prefersReducedMotion.current) {
      return;
    }
    const deltas = new Map(
      before
        .filter(({ node }) => node.isConnected)
        .map(({ node, y }) => [
          node,
          y - node.getBoundingClientRect().top - (scroll?.scrollTop ?? 0),
        ]),
    );
    for (const [node, delta] of deltas) {
      // A nested list inherits its parent card's translation; animate only its own displacement.
      const parent = node.parentElement?.closest<HTMLElement>('[data-step-row]');
      const y = delta - (parent ? (deltas.get(parent) ?? 0) : 0);
      if (y) {
        this.slide(node, y);
      }
    }
  }

  destroy() {
    for (const animation of this.animations.values()) {
      animation.cancel();
    }
  }

  private slide(node: HTMLElement, y: number) {
    const animation = node.animate(
      [{ transform: `translateY(${y}px)` }, { transform: 'translateY(0px)' }],
      { duration: 180, easing: 'ease-out' },
    );
    this.animations.set(node, animation);
    const finished = () => {
      if (this.animations.get(node) === animation) {
        this.animations.delete(node);
      }
    };
    void animation.finished.then(finished, finished);
  }
}

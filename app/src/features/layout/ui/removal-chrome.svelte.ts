// Editing chrome (selection overlay, handles) of a tile being removed fades out and stops taking input.
import { reducedMotion } from './tile-motion.svelte';

const FADE_MS = 140;

function disable(node: HTMLElement) {
  node.inert = true;
  node.style.pointerEvents = 'none';
}

export class RemovalChrome {
  /** Tiles whose removal animation is running. */
  readonly removing = $state<Record<string, boolean>>({});
  private readonly nodes = new Map<string, Set<HTMLElement>>();
  private readonly fades = new Map<string, Map<HTMLElement, Animation>>();

  /** Svelte action for a chrome element that belongs to the tile `id`. */
  register = (node: HTMLElement, initialId: string) => {
    let id = initialId;
    this.add(id, node);
    return {
      update: (nextId: string) => {
        if (nextId === id) {
          return;
        }
        this.remove(id, node);
        id = nextId;
        this.add(id, node);
      },
      destroy: () => {
        this.remove(id, node);
      },
    };
  };

  fadeOut(id: string) {
    this.removing[id] = true;
    for (const node of this.nodes.get(id) ?? []) {
      disable(node);
      this.fades.get(id)?.get(node)?.cancel();
      if (reducedMotion()) {
        node.style.opacity = '0';
        continue;
      }
      const opacity = Number.parseFloat(getComputedStyle(node).opacity) || 1;
      const animation = node.animate([{ opacity }, { opacity: 0 }], {
        duration: FADE_MS,
        fill: 'forwards',
      });
      const group = this.fades.get(id) ?? new Map<HTMLElement, Animation>();
      group.set(node, animation);
      this.fades.set(id, group);
    }
  }

  clear(id: string) {
    delete this.removing[id];
    for (const node of this.nodes.get(id) ?? []) {
      this.remove(id, node);
    }
  }

  private add(id: string, node: HTMLElement) {
    const group = this.nodes.get(id) ?? new Set<HTMLElement>();
    group.add(node);
    this.nodes.set(id, group);
    if (this.removing[id]) {
      disable(node);
      node.style.opacity = '0';
    }
  }

  private remove(id: string, node: HTMLElement) {
    this.nodes.get(id)?.delete(node);
    if (!this.nodes.get(id)?.size) {
      this.nodes.delete(id);
    }
    this.fades.get(id)?.get(node)?.cancel();
    this.fades.get(id)?.delete(node);
    if (!this.fades.get(id)?.size) {
      this.fades.delete(id);
    }
    node.inert = false;
    node.style.pointerEvents = '';
    node.style.opacity = '';
  }
}

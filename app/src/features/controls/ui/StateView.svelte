<script lang="ts">
  import { onDestroy, tick, untrack, type Snippet } from 'svelte';
  import type { TilePresentation } from '../model';

  let { presentation, immediate = false, class: className = 'relative h-full w-full', children }:
    { presentation: TilePresentation; immediate?: boolean; class?: string; children: Snippet<[TilePresentation['view']]> } = $props();
  const copy = (value: TilePresentation): TilePresentation => ({ key: value.key, view: {
    label: value.view.label, icon: value.view.icon, color: value.view.color, background: value.view.background,
  } });
  let shown = $state<TilePresentation>(untrack(() => copy(presentation)));
  let outgoing = $state<TilePresentation | null>(null);
  let outgoingOpacity = $state(0), incomingOpacity = $state(1);
  let outgoingNode = $state<HTMLElement>(), incomingNode = $state<HTMLElement>();
  let animations: Animation[] = [];
  let generation = 0;
  function sameView(a: TilePresentation['view'], b: TilePresentation['view']) {
    return a.label === b.label && a.icon === b.icon && a.color === b.color && a.background === b.background;
  }

  function sample(node: HTMLElement | undefined, fallback: number) {
    if (!node) return fallback;
    const opacity = Number.parseFloat(getComputedStyle(node).opacity);
    return Number.isFinite(opacity) ? opacity : fallback;
  }
  function stop() {
    for (const animation of animations) animation.cancel();
    animations = [];
  }
  function animate(node: HTMLElement | undefined, from: number, to: number) {
    if (!node) return Promise.resolve();
    const animation = node.animate([{ opacity: from }, { opacity: to }], { duration: 140, easing: 'linear', fill: 'forwards' });
    animations.push(animation);
    return animation.finished.catch(() => {});
  }

  $effect(() => {
    const next = presentation;
    const current = untrack(() => ({ shown, outgoing, outgoingOpacity, incomingOpacity, outgoingNode, incomingNode }));
    if (next.key === current.shown.key) {
      if (!sameView(next.view, current.shown.view)) shown = copy(next);
      return;
    }
    const hasOutgoing = current.outgoing != null;
    const sampledOutgoing = hasOutgoing ? sample(current.outgoingNode, current.outgoingOpacity) : 1;
    const sampledIncoming = hasOutgoing ? sample(current.incomingNode, current.incomingOpacity) : 0;
    generation++;
    stop();
    if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      outgoing = null;
      shown = copy(next);
      outgoingOpacity = 0;
      incomingOpacity = 1;
      return;
    }
    if (!hasOutgoing) outgoing = copy(current.shown);
    outgoingOpacity = sampledOutgoing;
    incomingOpacity = sampledIncoming;
    shown = copy(next);
    const run = generation;
    void tick().then(() => {
      if (run !== generation) return;
      return Promise.all([animate(outgoingNode, sampledOutgoing, 0), animate(incomingNode, sampledIncoming, 1)]);
    }).then(() => {
      if (run !== generation) return;
      outgoing = null;
      outgoingOpacity = 0;
      incomingOpacity = 1;
      stop();
    }).catch(() => {});
  });

  onDestroy(() => { generation++; stop(); });
</script>

<div data-dashboard-tile class="{className} relative">
  {#if outgoing}
    <div bind:this={outgoingNode} data-state-view-layer="outgoing" aria-hidden="true" inert
      class="pointer-events-none absolute inset-0" style:opacity={outgoingOpacity}>
      {@render children(outgoing.view)}
    </div>
  {/if}
  <div bind:this={incomingNode} data-state-view-layer="incoming" aria-hidden="true" class="pointer-events-none absolute inset-0"
    style:opacity={incomingOpacity}>
    {@render children(shown.view)}
  </div>
</div>

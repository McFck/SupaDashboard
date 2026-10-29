<script lang="ts">
  import { onDestroy } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import type { VinylDesign } from '../../media/vinyl';
  import { DiscSpin } from './now-playing-control.svelte';

  let {
    design,
    playing = false,
    visible = false,
  }: { design: VinylDesign; playing?: boolean; visible?: boolean } = $props();
  let rotor = $state<HTMLElement>();
  let size = $state(0);
  // Below this width the finest grooves would only read as noise.
  const grooves = $derived(
    size < 120 ? design.grooves.filter((groove) => groove.width >= 0.26) : design.grooves,
  );
  const spin = new DiscSpin();

  $effect(() => {
    void prefersReducedMotion.current;
    spin.update(rotor, playing, visible);
  });
  onDestroy(() => spin.destroy());
</script>

<div
  class="disc"
  bind:clientWidth={size}
>
  <div
    bind:this={rotor}
    class="h-full w-full"
  >
    <svg
      viewBox="0 0 100 100"
      class="block h-full w-full"
      aria-hidden="true"
    >
      <circle
        cx="50"
        cy="50"
        r="49.6"
        fill="#100e0c"
      />
      {#each grooves as groove, index (index)}
        <circle
          cx="50"
          cy="50"
          r={groove.r}
          fill="none"
          stroke="#f2ece6"
          stroke-width={groove.width}
          stroke-opacity={groove.opacity}
        />
      {/each}
      {#each design.marks as mark, index (index)}
        <path
          d={mark.d}
          fill="none"
          stroke={mark.colour}
          stroke-width={mark.width}
          stroke-linecap="round"
          stroke-opacity="0.16"
        />
      {/each}
      <circle
        cx={design.accent.cx}
        cy={design.accent.cy}
        r={design.accent.r}
        fill="none"
        stroke={design.accent.colour}
        stroke-width="0.35"
        stroke-opacity="0.5"
      />
      <circle
        cx="50"
        cy="50"
        r={design.label.r}
        fill={design.label.colour}
      />
      {#each design.arcs as arc, index (index)}
        <path
          d={arc.d}
          fill="none"
          stroke={arc.colour}
          stroke-width={arc.width}
          stroke-linecap="round"
          stroke-opacity="0.85"
        />
      {/each}
      <circle
        cx="50"
        cy="50"
        r="1.3"
        fill="#0f0d0c"
      />
    </svg>
  </div>
  <span class="sheen"></span>
</div>

<style>
  .disc {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.45);
  }
  /* The light stays put while the record turns under it. */
  .sheen {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    pointer-events: none;
    background: conic-gradient(
      from 20deg,
      transparent 0 6%,
      rgb(255 236 220 / 9%) 11%,
      transparent 17% 50%,
      rgb(255 236 220 / 6%) 60%,
      transparent 66%
    );
    mask: radial-gradient(circle, transparent 0 34%, #000 36% 99%, transparent 100%);
  }
</style>

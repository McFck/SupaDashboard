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
  const rings = $derived(
    size < 120 ? design.rings.filter((ring) => ring.width >= 0.26) : design.rings,
  );
  const spin = new DiscSpin();

  $effect(() => {
    void prefersReducedMotion.current;
    spin.update(rotor, playing, visible);
  });
  onDestroy(() => spin.destroy());
</script>

{#snippet shapes(list: VinylDesign['under'])}
  {#each list as shape, index (index)}
    <path
      d={shape.d}
      fill={shape.fill ?? 'none'}
      stroke={shape.stroke}
      stroke-width={shape.width}
      opacity={shape.opacity}
    />
  {/each}
{/snippet}

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
        fill={design.base}
      />
      {@render shapes(design.under)}
      {#each rings as ring, index (index)}
        <circle
          cx="50"
          cy="50"
          r={ring.r}
          fill="none"
          stroke={ring.colour}
          stroke-width={ring.width}
          stroke-opacity={ring.opacity}
        />
      {/each}
      {@render shapes(design.over)}
      {#each design.text as line, index (index)}
        <text
          x="50"
          y={line.y}
          font-size={line.size}
          fill={line.colour}>{line.content}</text
        >
      {/each}
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
  path {
    fill-rule: evenodd;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  text {
    font-family: var(--font-display);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-anchor: middle;
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

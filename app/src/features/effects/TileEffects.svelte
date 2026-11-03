<script lang="ts">
  import { runtimeView } from '../../app/runtime/state';
  import EffectVisual from './EffectVisual.svelte';
  let { itemId, controlId }: { itemId: string; controlId: string } = $props();
  const effects = $derived(
    ($runtimeView.effects ?? [])
      .filter((effect) => effect.tileId === itemId || effect.tileId === controlId)
      .slice(-2),
  );
</script>

{#each effects as effect (effect.id)}
  <EffectVisual
    effect={effect.effect}
    origin={effect.origin}
    stopping={effect.stopping}
  />
{/each}

<style>
  :global(
    [data-effect-tile]:has([data-effect='shake']:not(.stopping)) [data-effect-face] .widget-content
  ) {
    animation: tile-shake 160ms ease-in-out infinite;
  }
  @keyframes tile-shake {
    0%,
    100% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(-3px) rotate(-1deg);
    }
    75% {
      transform: translateX(3px) rotate(1deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global([data-effect-tile] [data-effect-face] .widget-content) {
      animation: none !important;
    }
  }
</style>

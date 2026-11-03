<script lang="ts">
  // Fine-line monochrome glyph over a faint tinted light; hovering its holder previews the effect.
  import { cn } from '$lib/utils';
  import { effectTint, type EffectId } from './catalogue';

  let { effect, class: className }: { effect: EffectId; class?: string } = $props();
  // Gradient ids are document-global, so every instance gets its own.
  const id = $props.id();
  const SPOKES = [0, 60, 120, 180, 240, 300];
  const SLIVERS = [
    { x: 5, y: 5, r: -25, o: 0.5 },
    { x: 12, y: 3.5, r: 30, o: 1 },
    { x: 18.5, y: 7, r: -50, o: 0.7 },
    { x: 7.5, y: 12.5, r: 55, o: 0.85 },
    { x: 15.5, y: 13, r: -15, o: 0.45 },
    { x: 10, y: 19.5, r: 20, o: 0.7 },
    { x: 18, y: 18.5, r: -40, o: 1 },
  ];
  const BUBBLES = [
    { x: 9.5, y: 14.5, r: 5.5 },
    { x: 17, y: 7.5, r: 3.2 },
    { x: 18, y: 18, r: 2 },
  ];
</script>

<svg
  viewBox="0 0 24 24"
  aria-hidden="true"
  class={cn('effect-icon size-6 shrink-0 overflow-visible', className)}
  fill="none"
  stroke="currentColor"
  stroke-width="1.1"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <defs>
    <radialGradient id="{id}-light">
      <stop
        offset="0"
        stop-color={effectTint(effect)}
        stop-opacity="0.45"
      />
      <stop
        offset="1"
        stop-color={effectTint(effect)}
        stop-opacity="0"
      />
    </radialGradient>
  </defs>
  <circle
    class="light"
    cx="12"
    cy="12"
    r="12"
    fill="url(#{id}-light)"
    stroke="none"
  />
  {#if effect === 'shake'}
    <path
      class="lines"
      d="M3.5 9.5v5M1.5 11v2M20.5 9.5v5M22.5 11v2"
      stroke-opacity="0.5"
    />
    <g class="shake">
      <rect
        x="7"
        y="5.5"
        width="10"
        height="13"
        rx="2.5"
      />
      <path
        d="M9.5 15.5h5"
        stroke-opacity="0.5"
      />
    </g>
  {:else if effect === 'hearts'}
    <path
      class="float"
      d="M18.5 6.4s-2-1.2-2-2.7a1.15 1.15 0 0 1 2-.8 1.15 1.15 0 0 1 2 .8c0 1.5-2 2.7-2 2.7z"
      stroke-opacity="0.6"
    />
    <path
      class="beat"
      d="M11 20.5s-7.5-4.4-7.5-9.9A4.3 4.3 0 0 1 11 7.9a4.3 4.3 0 0 1 7.5 2.7c0 5.5-7.5 9.9-7.5 9.9z"
    />
  {:else if effect === 'lightning'}
    <g class="flash">
      <path d="M13 1.5 10.4 7l2.6 1.6-3.8 5.6 2.2 1.2-3.1 7.1" />
      <path
        d="m10.4 7-3.2 3.3M13 8.6l3.6 2.6.6 3.3M9.2 14.2l-2.7 1.7"
        stroke-width="0.7"
        stroke-opacity="0.6"
      />
    </g>
  {:else if effect === 'sparkles'}
    <path
      class="twinkle"
      d="M10 3.5c.5 4.8 1.2 5.5 6 6-4.8.5-5.5 1.2-6 6-.5-4.8-1.2-5.5-6-6 4.8-.5 5.5-1.2 6-6z"
    />
    <path
      class="twinkle late"
      d="M18.5 2.5v4M16.5 4.5h4"
      stroke-width="0.8"
    />
    <path
      class="twinkle"
      d="M18 15.5v3.5M16.25 17.25h3.5"
      stroke-width="0.8"
      stroke-opacity="0.7"
    />
  {:else if effect === 'confetti'}
    {#each SLIVERS as piece, index (index)}
      <g
        class="fall"
        style:animation-delay="{index * -0.17}s"
      >
        <path
          d="M{piece.x - 1.4} {piece.y}h2.8"
          stroke-opacity={piece.o}
          transform="rotate({piece.r} {piece.x} {piece.y})"
        />
      </g>
    {/each}
  {:else if effect === 'ripple'}
    <circle
      class="ring"
      cx="12"
      cy="12"
      r="10"
      stroke-width="0.7"
      stroke-opacity="0.35"
    />
    <circle
      class="ring late"
      cx="12"
      cy="12"
      r="6.5"
      stroke-width="0.9"
      stroke-opacity="0.7"
    />
    <circle
      cx="12"
      cy="12"
      r="2"
      fill="currentColor"
      stroke="none"
    />
  {:else if effect === 'glow'}
    <circle
      class="halo"
      cx="12"
      cy="12"
      r="9"
      stroke-width="0.7"
      stroke-dasharray="0.6 2.2"
      stroke-opacity="0.6"
    />
    <circle
      cx="12"
      cy="12"
      r="4.5"
    />
    <circle
      cx="12"
      cy="12"
      r="1.6"
      fill="currentColor"
      stroke="none"
    />
  {:else if effect === 'snow'}
    <g class="spin">
      {#each SPOKES as angle (angle)}
        <path
          d="M12 12V2.5M10.2 4.5 12 6.2l1.8-1.7M10.8 8.4 12 9.5l1.2-1.1"
          transform="rotate({angle} 12 12)"
          stroke-width="0.9"
        />
      {/each}
    </g>
  {:else if effect === 'fire'}
    <g class="flicker">
      <path
        d="M12 2c.8 3.4 6 5.8 6 11.5a6 6 0 0 1-12 0c0-2.8 1.4-4.5 2.9-5.6.1 1.7.8 2.8 2 3.2-.3-3.8-.3-6.8 1.1-9.1z"
      />
      <path
        d="M12 13c.5 1.6 2.6 2.6 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1.5.9-2.4 1.6-3"
        stroke-opacity="0.6"
      />
    </g>
  {:else}
    {#each BUBBLES as bubble, index (index)}
      <g
        class="rise"
        style:animation-delay="{index * -0.4}s"
      >
        <circle
          cx={bubble.x}
          cy={bubble.y}
          r={bubble.r}
        />
        <path
          d="M{bubble.x - bubble.r * 0.55} {bubble.y - bubble.r * 0.1}a{bubble.r * 0.6} {bubble.r *
            0.6} 0 0 1 {bubble.r * 0.45} -{bubble.r * 0.45}"
          stroke-width="0.7"
          stroke-opacity="0.7"
        />
      </g>
    {/each}
  {/if}
</svg>

<style>
  /* Only animated parts: the static spokes and slivers keep their attribute rotations. */
  :is(
    .shake,
    .lines,
    .beat,
    .float,
    .flash,
    .twinkle,
    .fall,
    .ring,
    .halo,
    .spin,
    .flicker,
    .rise,
    .light
  ) {
    transform-box: fill-box;
    transform-origin: center;
  }
  /* Hovering or focusing the control that holds the icon plays its preview. */
  @media (prefers-reduced-motion: no-preference) {
    :global(:is(:hover, :focus-visible)) > .effect-icon .light {
      animation: halo 1.2s ease-in-out infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .shake {
      animation: shake 0.45s ease-in-out infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .lines {
      animation: fade 0.45s ease-in-out infinite alternate;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .beat {
      animation: beat 0.8s ease-in-out infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .float {
      animation: float 1.2s ease-out infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .flash {
      animation: flash 0.9s steps(1) infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .twinkle {
      animation: twinkle 1s ease-in-out infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .fall {
      animation: fall 1.1s linear infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .ring {
      animation: ring 1.2s ease-out infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .halo {
      animation: halo 1.2s ease-in-out infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .spin {
      animation: spin 6s linear infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .flicker {
      animation: flicker 0.5s ease-in-out infinite alternate;
      transform-origin: bottom;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .rise {
      animation: rise 1.2s ease-in infinite;
    }
    :global(:is(:hover, :focus-visible)) > .effect-icon .late {
      animation-delay: -0.5s;
    }
  }
  @keyframes shake {
    25% {
      transform: translateX(-1px) rotate(-4deg);
    }
    75% {
      transform: translateX(1px) rotate(4deg);
    }
  }
  @keyframes fade {
    to {
      opacity: 0.2;
    }
  }
  @keyframes beat {
    15%,
    45% {
      transform: scale(1.1);
    }
    30% {
      transform: scale(1);
    }
  }
  @keyframes float {
    to {
      transform: translateY(-5px) scale(0.6);
      opacity: 0;
    }
  }
  @keyframes flash {
    0%,
    30%,
    60% {
      opacity: 1;
    }
    20%,
    45% {
      opacity: 0.3;
    }
  }
  @keyframes twinkle {
    50% {
      transform: scale(0.6) rotate(45deg);
      opacity: 0.5;
    }
  }
  @keyframes fall {
    from {
      transform: translateY(-4px) rotate(0);
    }
    to {
      transform: translateY(4px) rotate(180deg);
    }
  }
  @keyframes ring {
    from {
      transform: scale(0.4);
      opacity: 1;
    }
    to {
      transform: scale(1.15);
      opacity: 0;
    }
  }
  @keyframes halo {
    50% {
      transform: scale(0.8);
      opacity: 0.5;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes flicker {
    to {
      transform: scale(0.94, 1.06) skewX(-3deg);
    }
  }
  @keyframes rise {
    from {
      transform: translateY(2px);
      opacity: 1;
    }
    to {
      transform: translateY(-6px);
      opacity: 0;
    }
  }
</style>

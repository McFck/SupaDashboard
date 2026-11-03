<script lang="ts">
  // One glossy glyph per effect; hovering the element that holds it previews the effect in miniature.
  import { cn } from '$lib/utils';
  import type { EffectId } from './catalogue';

  let { effect, class: className }: { effect: EffectId; class?: string } = $props();
  // Gradient ids are document-global, so every instance gets its own.
  const id = $props.id();
  const fill = (name: string) => `url(#${id}-${name})`;
  const PALETTE: Record<EffectId, [string, string]> = {
    shake: ['#c4b5fd', '#7c3aed'],
    hearts: ['#fda4af', '#e11d48'],
    lightning: ['#fef08a', '#f59e0b'],
    sparkles: ['#fef3c7', '#eab308'],
    confetti: ['#f9a8d4', '#db2777'],
    ripple: ['#a5f3fc', '#0891b2'],
    glow: ['#fde68a', '#f97316'],
    snow: ['#e0f2fe', '#38bdf8'],
    fire: ['#fde047', '#ea580c'],
    bubbles: ['#bae6fd', '#2563eb'],
  };
  const tone = $derived(PALETTE[effect]);
  const SPOKES = [0, 60, 120, 180, 240, 300];
  const CONFETTI = [
    { x: 4, y: 5, r: -20, c: '#f472b6' },
    { x: 11, y: 3, r: 25, c: '#facc15' },
    { x: 17, y: 6, r: -35, c: '#22d3ee' },
    { x: 6, y: 13, r: 40, c: '#a3e635' },
    { x: 14, y: 12, r: -10, c: '#a78bfa' },
    { x: 9, y: 19, r: 15, c: '#fb923c' },
    { x: 17, y: 18, r: -45, c: '#f472b6' },
  ];
</script>

<svg
  viewBox="0 0 24 24"
  aria-hidden="true"
  class={cn('effect-icon size-6 shrink-0 overflow-visible', className)}
>
  <defs>
    <linearGradient
      id="{id}-body"
      x1="0"
      y1="0"
      x2="0"
      y2="1"
    >
      <stop
        offset="0"
        stop-color={tone[0]}
      />
      <stop
        offset="1"
        stop-color={tone[1]}
      />
    </linearGradient>
    <radialGradient
      id="{id}-orb"
      cx="0.38"
      cy="0.32"
      r="0.75"
    >
      <stop
        offset="0"
        stop-color="#fff"
        stop-opacity="0.95"
      />
      <stop
        offset="0.35"
        stop-color={tone[0]}
      />
      <stop
        offset="1"
        stop-color={tone[1]}
      />
    </radialGradient>
  </defs>
  {#if effect === 'shake'}
    <g
      class="lines"
      stroke={tone[0]}
      stroke-width="1.6"
      stroke-linecap="round"
      fill="none"
    >
      <path d="M3.5 9v6M1.5 10.5v3M20.5 9v6M22.5 10.5v3" />
    </g>
    <g class="shake">
      <rect
        x="6.5"
        y="5"
        width="11"
        height="14"
        rx="3"
        fill={fill('body')}
      />
      <path
        d="M8.5 8.5c0-1 .7-1.5 1.6-1.5h3.6"
        stroke="#fff"
        stroke-opacity="0.55"
        stroke-width="1.2"
        stroke-linecap="round"
        fill="none"
      />
    </g>
  {:else if effect === 'hearts'}
    <path
      class="float"
      d="M19 6.6s-2.4-1.4-2.4-3.2a1.4 1.4 0 0 1 2.4-1 1.4 1.4 0 0 1 2.4 1c0 1.8-2.4 3.2-2.4 3.2z"
      fill={tone[0]}
    />
    <g class="beat">
      <path
        d="M11 21s-8-4.7-8-10.6A4.6 4.6 0 0 1 11 7.5a4.6 4.6 0 0 1 8 2.9C19 16.3 11 21 11 21z"
        fill={fill('body')}
      />
      <ellipse
        cx="7.3"
        cy="10.6"
        rx="1.7"
        ry="1"
        transform="rotate(-35 7.3 10.6)"
        fill="#fff"
        fill-opacity="0.6"
      />
    </g>
  {:else if effect === 'lightning'}
    <path
      class="flash"
      d="M13.8 1.5 4.5 13.6h6.3L9.2 22.5l10.3-12.6h-6.4l.7-8.4z"
      fill={fill('body')}
      stroke="#fff"
      stroke-opacity="0.35"
      stroke-width="0.6"
      stroke-linejoin="round"
    />
  {:else if effect === 'sparkles'}
    <path
      class="twinkle"
      d="M10 4c.7 4.6 1.4 5.3 6 6-4.6.7-5.3 1.4-6 6-.7-4.6-1.4-5.3-6-6 4.6-.7 5.3-1.4 6-6z"
      fill={fill('body')}
    />
    <path
      class="twinkle late"
      d="M18.5 2.5c.3 1.9.6 2.2 2.5 2.5-1.9.3-2.2.6-2.5 2.5-.3-1.9-.6-2.2-2.5-2.5 1.9-.3 2.2-.6 2.5-2.5z"
      fill={tone[0]}
    />
    <path
      class="twinkle"
      d="M18 15c.3 1.6.5 1.8 2 2-1.5.2-1.7.4-2 2-.3-1.6-.5-1.8-2-2 1.5-.2 1.7-.4 2-2z"
      fill={tone[0]}
    />
  {:else if effect === 'confetti'}
    {#each CONFETTI as piece, index (index)}
      <g
        class="fall"
        style:animation-delay="{index * -0.17}s"
      >
        <rect
          x={piece.x}
          y={piece.y}
          width="3.2"
          height="1.8"
          rx="0.5"
          fill={piece.c}
          transform="rotate({piece.r} {piece.x + 1.6} {piece.y + 0.9})"
        />
      </g>
    {/each}
  {:else if effect === 'ripple'}
    <g
      fill="none"
      stroke={tone[0]}
    >
      <circle
        class="ring"
        cx="12"
        cy="12"
        r="9.5"
        stroke-width="1.2"
        stroke-opacity="0.45"
      />
      <circle
        class="ring late"
        cx="12"
        cy="12"
        r="6.2"
        stroke-width="1.5"
        stroke-opacity="0.8"
      />
    </g>
    <circle
      cx="12"
      cy="12"
      r="3"
      fill={fill('orb')}
    />
  {:else if effect === 'glow'}
    <circle
      class="halo"
      cx="12"
      cy="12"
      r="10.5"
      fill={tone[0]}
      fill-opacity="0.28"
    />
    <circle
      cx="12"
      cy="12"
      r="6.5"
      fill={fill('orb')}
    />
  {:else if effect === 'snow'}
    <g
      class="spin"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    >
      {#each SPOKES as angle (angle)}
        <path
          d="M12 12V2.8M9.6 4.6 12 6.8l2.4-2.2"
          stroke={angle < 90 || angle > 270 ? tone[0] : tone[1]}
          transform="rotate({angle} 12 12)"
        />
      {/each}
    </g>
  {:else if effect === 'fire'}
    <g class="flicker">
      <path
        d="M12 1.8c.9 3.6 6.3 6 6.3 12a6.3 6.3 0 0 1-12.6 0c0-2.9 1.5-4.7 3-5.9.1 1.8.9 3 2.1 3.4-.3-4-.3-7.1 1.2-9.5z"
        fill={fill('body')}
      />
      <path
        d="M12 12.8c.5 1.7 3 2.8 3 5.4a3 3 0 0 1-6 0c0-1.6 1-2.6 1.8-3.2.1.9.5 1.3 1 1.5-.1-1.5 0-2.7.2-3.7z"
        fill="#fef9c3"
        fill-opacity="0.9"
      />
    </g>
  {:else}
    {#each [{ x: 9, y: 15, r: 5.5 }, { x: 17.5, y: 8, r: 3.4 }, { x: 18, y: 18.5, r: 2.2 }] as bubble, index (index)}
      <g
        class="rise"
        style:animation-delay="{index * -0.4}s"
      >
        <circle
          cx={bubble.x}
          cy={bubble.y}
          r={bubble.r}
          fill={fill('orb')}
          fill-opacity="0.85"
          stroke={tone[0]}
          stroke-width="0.6"
        />
      </g>
    {/each}
  {/if}
</svg>

<style>
  .effect-icon {
    filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.35));
  }
  /* Only animated parts: the static spokes and confetti keep their attribute rotations. */
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
    .rise
  ) {
    transform-box: fill-box;
    transform-origin: center;
  }
  /* Hovering or focusing the control that holds the icon plays its preview. */
  @media (prefers-reduced-motion: no-preference) {
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
      animation: spin 3s linear infinite;
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
      transform: translateX(-1.5px) rotate(-6deg);
    }
    75% {
      transform: translateX(1.5px) rotate(6deg);
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
      transform: scale(1.14);
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
      filter: brightness(1.5);
    }
    20%,
    45% {
      opacity: 0.35;
      filter: none;
    }
  }
  @keyframes twinkle {
    50% {
      transform: scale(0.55) rotate(45deg);
      opacity: 0.6;
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
      transform: scale(0.75);
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
      transform: scale(0.92, 1.08) skewX(-3deg);
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

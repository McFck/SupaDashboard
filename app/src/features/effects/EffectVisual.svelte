<script lang="ts">
  import { strikePath } from './bolt';
  import { effectTint, type EffectId } from './catalogue';
  let {
    effect,
    origin = { x: 0.5, y: 0.5 },
    stopping = false,
  }: {
    effect: EffectId;
    origin?: { x: number; y: number };
    stopping?: boolean;
  } = $props();
  const COUNT: Record<EffectId, number> = {
    shake: 1,
    hearts: 9,
    lightning: 0,
    sparkles: 9,
    confetti: 14,
    ripple: 3,
    glow: 1,
    snow: 14,
    fire: 12,
    bubbles: 8,
  };
  // Three depth planes: far particles are smaller, dimmer and slower.
  const DEPTH = [
    { k: 0.55, o: 0.4, slow: 1.35 },
    { k: 0.8, o: 0.7, slow: 1.15 },
    { k: 1.1, o: 1, slow: 1 },
  ];
  // Golden-ratio scatter gives an even, stable spread without a random source.
  const particles = $derived(
    Array.from({ length: COUNT[effect] }, (_, i) => ({
      i,
      x: (i * 0.618034 + 0.13) % 1,
      r: (i * 0.381966 + 0.57) % 1,
      ...DEPTH[i % 3],
    })),
  );
  const strike = $derived(effect === 'lightning' ? strikePath(origin.x) : undefined);
</script>

<div
  data-effect={effect}
  aria-hidden="true"
  class="effect-visual {effect}"
  class:stopping
  style:--tint={effectTint(effect)}
  style:--origin-x="{origin.x * 100}%"
  style:--origin-y="{origin.y * 100}%"
  style:--strike-x={strike ? `${strike.x}%` : undefined}
>
  {#each particles as p (p.i)}
    <span
      style:--i={p.i}
      style:--x={p.x}
      style:--r={p.r}
      style:--k={p.k}
      style:--o={p.o}
      style:--slow={p.slow}
    ></span>
  {/each}
  {#if strike}
    <i class="flash"></i>
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {#each strike.paths as d, k (k)}
        <path
          class="halo"
          class:branch={k > 0}
          {d}
        />
        <path
          class="core"
          class:branch={k > 0}
          pathLength="1"
          {d}
        />
      {/each}
    </svg>
  {/if}
</div>

<style>
  .effect-visual {
    position: absolute;
    inset: 0;
    z-index: 5;
    overflow: hidden;
    border-radius: inherit;
    pointer-events: none;
    transition: opacity 180ms ease-out;
    opacity: 1;
    contain: paint;
    container-type: size;
    /* Particle unit: 1px on a 1x1 tile, growing with larger tiles. */
    --u: clamp(1px, 0.45cqmin, 2.2px);
    --soft: color-mix(in srgb, var(--tint) 30%, transparent);
    --faint: color-mix(in srgb, var(--tint) 14%, transparent);
  }
  /* Atmosphere: a tinted light veil plus dark film grain shared by every effect. Blend modes would
     only see this isolated layer, not the tile below, so the grain is plain translucent specks. */
  .effect-visual::before,
  .effect-visual::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .effect-visual::before {
    background: radial-gradient(
      120% 100% at var(--veil-x, var(--origin-x)) var(--veil-y, var(--origin-y)),
      var(--faint),
      transparent 70%
    );
    animation: veil 760ms ease-out both;
  }
  .effect-visual::after {
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .4 0 0 0 -.16'/%3E%3C/filter%3E%3Crect width='96' height='96' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .effect-visual.stopping {
    opacity: 0;
  }
  span {
    position: absolute;
    left: calc(var(--x) * 92% + 4%);
    opacity: calc(var(--o) * 0.9);
  }
  .hearts,
  .fire,
  .bubbles {
    --veil-y: 110%;
  }
  .snow,
  .confetti {
    --veil-y: -10%;
  }
  .hearts span {
    bottom: -12%;
    width: calc(15 * var(--u) * var(--k));
    aspect-ratio: 1;
    background: linear-gradient(170deg, #fff 0%, var(--tint) 55%, var(--soft));
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 21s-8.5-5-8.5-11.2A4.7 4.7 0 0 1 12 7a4.7 4.7 0 0 1 8.5 2.8C20.5 16 12 21 12 21z'/%3E%3C/svg%3E")
      center / contain no-repeat;
    animation: drift-up calc(1.7s * var(--slow)) ease-in infinite;
    animation-delay: calc(var(--r) * -1.7s);
  }
  .snow span {
    top: -6%;
    width: calc(6 * var(--u) * var(--k));
    aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(circle, #fff 0 30%, var(--soft) 55%, transparent 72%);
    animation: drift-down calc(2.2s * var(--slow)) linear infinite;
    animation-delay: calc(var(--r) * -2.2s);
  }
  .sparkles span {
    top: calc(8% + var(--r) * 80%);
    width: calc(26 * var(--u) * var(--k));
    aspect-ratio: 1;
    translate: -50% -50%;
    background:
      radial-gradient(circle, #fff 0 1.5px, var(--soft) 3px, transparent 7px),
      linear-gradient(90deg, transparent, var(--tint) 50%, transparent) center / 100% 1px no-repeat,
      linear-gradient(transparent, var(--tint) 50%, transparent) center / 1px 100% no-repeat;
    animation: glint 900ms ease-in-out infinite;
    animation-delay: calc(var(--r) * -900ms);
  }
  .confetti span {
    top: -8%;
    width: calc(3 * var(--u) * var(--k));
    height: calc(10 * var(--u) * var(--k));
    background: linear-gradient(#fff 0%, var(--paper) 40%);
    --paper: var(--tint);
    animation: flutter calc(1.6s * var(--slow)) linear infinite;
    animation-delay: calc(var(--r) * -1.6s);
  }
  .confetti span:nth-child(3n) {
    --paper: #a9a49c;
  }
  .confetti span:nth-child(4n) {
    --paper: #d6bd86;
  }
  .fire::before {
    background:
      radial-gradient(
        90% 55% at 50% 115%,
        color-mix(in srgb, var(--tint) 45%, transparent),
        transparent
      ),
      radial-gradient(120% 100% at 50% 110%, var(--faint), transparent 70%);
    animation: smoulder 380ms ease-in-out infinite alternate;
  }
  .fire span {
    bottom: -4%;
    width: calc(5 * var(--u) * var(--k));
    aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(circle, #fff7e6 0 22%, var(--tint) 45%, transparent 72%);
    animation: ember calc(1.1s * var(--slow)) ease-out infinite;
    animation-delay: calc(var(--r) * -1.1s);
  }
  .bubbles span {
    bottom: -14%;
    width: calc(22 * var(--u) * var(--k));
    aspect-ratio: 1;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--tint) 55%, transparent);
    background:
      radial-gradient(circle at 32% 28%, #fffc 0 6%, transparent 24%),
      radial-gradient(circle, transparent 58%, var(--faint) 100%);
    animation: drift-up calc(2s * var(--slow)) ease-in-out infinite;
    animation-delay: calc(var(--r) * -2s);
  }
  .ripple span {
    left: var(--origin-x);
    top: var(--origin-y);
    width: 150cqmax;
    aspect-ratio: 1;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--tint) 75%, transparent);
    box-shadow:
      0 0 14px var(--soft),
      inset 0 0 10px var(--faint);
    opacity: 0;
    animation: ripple 1.1s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
    animation-delay: calc(var(--i) * 140ms);
  }
  .glow span,
  .shake span {
    inset: 0;
    border-radius: inherit;
    opacity: 1;
  }
  .glow span {
    background: radial-gradient(
      70% 70% at var(--origin-x) var(--origin-y),
      color-mix(in srgb, var(--tint) 34%, transparent),
      transparent 75%
    );
    box-shadow:
      inset 0 0 0 1px var(--soft),
      inset 0 0 28px var(--soft);
    animation: breathe 1.1s ease-in-out infinite;
  }
  .shake span {
    box-shadow:
      inset 0 0 0 1px var(--soft),
      inset 0 0 22px var(--faint);
    animation: breathe 320ms ease-in-out infinite;
  }
  .lightning {
    --veil-x: var(--strike-x);
    --veil-y: 0%;
  }
  .flash {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(90% 70% at var(--strike-x) 10%, #fff8, transparent 70%),
      color-mix(in srgb, var(--tint) 22%, transparent);
    opacity: 0;
    animation: flash 760ms linear infinite;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    filter: drop-shadow(0 0 4px var(--tint));
    animation: bolt 760ms linear infinite;
  }
  path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .halo {
    stroke: color-mix(in srgb, var(--tint) 18%, transparent);
    stroke-width: 5px;
  }
  .core {
    stroke: #fff;
    stroke-width: 1.6px;
    stroke-dasharray: 1;
    animation: draw 760ms linear infinite;
  }
  .branch {
    stroke-width: 0.9px;
    animation:
      draw 760ms linear infinite,
      branch 760ms linear infinite;
  }
  .halo.branch {
    stroke-width: 3px;
    animation: branch 760ms linear infinite;
  }
  @keyframes veil {
    from {
      opacity: 0;
    }
  }
  @keyframes drift-down {
    from {
      transform: translate(0, -10px);
    }
    50% {
      transform: translate(6px, 60cqh);
    }
    to {
      transform: translate(-2px, 120cqh);
    }
  }
  @keyframes drift-up {
    from {
      transform: translate(0, 0) rotate(-6deg);
      opacity: 0;
    }
    20% {
      opacity: var(--o);
    }
    55% {
      transform: translate(5px, -65cqh) rotate(5deg);
    }
    to {
      transform: translate(-3px, -125cqh) rotate(-4deg);
      opacity: 0;
    }
  }
  @keyframes glint {
    0%,
    100% {
      transform: scale(0.1) rotate(-20deg);
      opacity: 0;
    }
    50% {
      transform: scale(1) rotate(10deg);
      opacity: var(--o);
    }
  }
  @keyframes flutter {
    from {
      transform: translateY(0) rotate(0) rotateX(0);
    }
    to {
      transform: translate(14px, 120cqh) rotate(220deg) rotateX(720deg);
    }
  }
  @keyframes ember {
    from {
      transform: translate(0, 0) scale(1);
      opacity: 0;
    }
    15% {
      opacity: var(--o);
    }
    50% {
      transform: translate(-6px, -45cqh) scale(0.8);
    }
    to {
      transform: translate(4px, -95cqh) scale(0.3);
      opacity: 0;
    }
  }
  @keyframes smoulder {
    to {
      opacity: 0.6;
    }
  }
  @keyframes ripple {
    from {
      transform: translate(-50%, -50%) scale(0.02);
      opacity: 1;
    }
    to {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0;
    }
  }
  @keyframes breathe {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 1;
    }
  }
  /* One strike: leader draws, flash, flicker, restrike, long afterglow. */
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
    7%,
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes bolt {
    0% {
      opacity: 0;
    }
    3%,
    10% {
      opacity: 1;
    }
    14% {
      opacity: 0.3;
    }
    19% {
      opacity: 1;
    }
    32% {
      opacity: 0.75;
    }
    to {
      opacity: 0;
    }
  }
  @keyframes branch {
    0%,
    4% {
      opacity: 0;
    }
    9% {
      opacity: 1;
    }
    40%,
    to {
      opacity: 0;
    }
  }
  @keyframes flash {
    0%,
    4% {
      opacity: 0;
    }
    8% {
      opacity: 1;
    }
    13% {
      opacity: 0.15;
    }
    19% {
      opacity: 0.7;
    }
    45% {
      opacity: 0.08;
    }
    to {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .effect-visual {
      animation: calm-glow 700ms ease-out both;
      box-shadow: inset 0 0 22px var(--soft);
      background: var(--faint);
    }
    .effect-visual > * {
      display: none;
    }
  }
  @keyframes calm-glow {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
</style>

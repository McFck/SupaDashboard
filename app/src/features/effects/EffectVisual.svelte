<script lang="ts">
  import { EFFECTS, type EffectId } from './catalogue';
  let {
    effect,
    origin = { x: 0.5, y: 0.5 },
    stopping = false,
  }: {
    effect: EffectId;
    origin?: { x: number; y: number };
    stopping?: boolean;
  } = $props();
  const glyph = $derived(EFFECTS.find((entry) => entry.id === effect)?.icon ?? '✦');
  const count = $derived(
    ['glow', 'ripple', 'shake'].includes(effect) ? 1 : effect === 'lightning' ? 3 : 14,
  );
</script>

<div
  data-effect={effect}
  aria-hidden="true"
  class="effect-visual {effect}"
  class:stopping
  style:--origin-x="{origin.x * 100}%"
  style:--origin-y="{origin.y * 100}%"
>
  {#each { length: count } as _, i}
    <span
      style:--i={i}
      style:--x="{8 + ((i * 37) % 84)}%"
      style:--hue={(i * 67) % 360}>{glyph}</span
    >
  {/each}
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
  }
  .effect-visual.stopping {
    animation: none;
    opacity: 0;
  }
  span {
    position: absolute;
    left: var(--x);
    font-size: 20px;
    line-height: 1;
  }
  .hearts span {
    color: #fb779f;
    top: -20%;
    animation: fall 1.15s linear infinite;
  }
  .snow span {
    color: #dcf4ff;
    top: -20%;
    font-size: 12px;
    animation: fall 1.8s linear infinite;
  }
  .hearts span,
  .snow span {
    animation-delay: calc(var(--i) * -0.13s);
  }
  .sparkles span {
    color: #fff3ad;
    top: calc(10% + mod(var(--i) * 23, 75) * 1%);
    animation: twinkle 850ms ease-in-out infinite;
    animation-delay: calc(var(--i) * -0.11s);
  }
  .confetti span {
    top: -20%;
    color: hsl(var(--hue) 85% 70%);
    font-size: 13px;
    animation: tumble 1.1s linear infinite;
    animation-delay: calc(var(--i) * -0.1s);
  }
  .fire span {
    bottom: -20%;
    color: #ffc16a;
    text-shadow: 0 0 12px #fc6535;
    font-size: 14px;
    animation: rise 1s ease-out infinite;
    animation-delay: calc(var(--i) * -0.09s);
  }
  .bubbles span {
    bottom: -20%;
    color: #a1e8ff;
    font-size: 27px;
    animation: rise 1.6s ease-in-out infinite;
    animation-delay: calc(var(--i) * -0.15s);
  }
  .lightning {
    animation: flash 650ms ease-out infinite;
  }
  .lightning span {
    top: calc(5% + var(--i) * 20%);
    left: calc(10% + var(--i) * 30%);
    font-size: 72px;
    color: #c7eeff;
    text-shadow: 0 0 15px #82d7ff;
    animation: bolt 650ms steps(1) infinite;
    animation-delay: calc(var(--i) * -0.15s);
  }
  .glow,
  .shake {
    box-shadow: inset 0 0 30px #89caff88;
    animation: pulse 900ms ease-in-out infinite;
  }
  .glow span,
  .shake span {
    display: none;
  }
  .ripple span {
    left: var(--origin-x);
    top: var(--origin-y);
    width: 18px;
    height: 18px;
    border: 2px solid #b4e9ff;
    border-radius: 50%;
    color: transparent;
    animation: ripple 900ms ease-out infinite;
  }
  @keyframes fall {
    from {
      transform: translate(-6px, -20px) rotate(-15deg);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    to {
      transform: translate(9px, 140cqh) rotate(20deg);
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      transform: translate(0, 0) scale(0.6);
      opacity: 0;
    }
    20% {
      opacity: 0.9;
    }
    to {
      transform: translate(12px, -140cqh) scale(1.2);
      opacity: 0;
    }
  }
  @keyframes tumble {
    from {
      transform: translateY(0) rotate(0);
      opacity: 1;
    }
    to {
      transform: translateY(140cqh) rotate(400deg);
      opacity: 0;
    }
  }
  @keyframes twinkle {
    0%,
    100% {
      transform: scale(0.15) rotate(-30deg);
      opacity: 0;
    }
    50% {
      transform: scale(1) rotate(30deg);
      opacity: 1;
    }
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }
  @keyframes ripple {
    from {
      transform: translate(-50%, -50%) scale(0.1);
      opacity: 1;
    }
    to {
      transform: translate(-50%, -50%) scale(18);
      opacity: 0;
    }
  }
  @keyframes bolt {
    0%,
    24%,
    58% {
      opacity: 0;
    }
    10%,
    30%,
    65% {
      opacity: 1;
    }
  }
  @keyframes flash {
    0%,
    22%,
    100% {
      background: transparent;
    }
    8%,
    28% {
      background: #c4edff24;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .effect-visual {
      animation: calm-glow 700ms ease-out both;
      box-shadow: inset 0 0 22px #a0d6ff66;
      background: #a0d6ff0a;
    }
    span {
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

<script lang="ts">
  // Palette bubbles, a rainbow bubble that opens our own picker, and an opacity slider. Value: "#rrggbb" or "#rrggbbaa".
  import Pipette from '@lucide/svelte/icons/pipette';
  import { Popover } from 'bits-ui';
  import { Input } from '$lib/components/ui/input';
  import { Slider } from '$lib/components/ui/slider';
  import { ACCENTS, hexToHsv, hsvToHex, splitAlpha, withAlpha } from '../palette';

  let {
    value,
    onchange,
    palette = ACCENTS,
  }: { value: string; onchange: (v: string) => void; palette?: string[] } = $props();
  const parts = $derived(splitAlpha(value));
  const custom = $derived(!palette.includes(parts.hex));
  let open = $state(false);
  // Local HSV so hue survives dragging through grey/black, where the hex alone loses it.
  let hsv = $state({ h: 0, s: 0, v: 0 });
  let hexText = $state('');
  let lastHex = '';
  $effect(() => {
    if (open && parts.hex !== lastHex) {
      hsv = hexToHsv(parts.hex);
      hexText = parts.hex;
      lastHex = parts.hex;
    }
  });
  const RAINBOW =
    'conic-gradient(#e5484d, #f76b15, #e2a336, #46a758, #12a594, #0090ff, #8e4ec6, #d6409f, #e5484d)';

  function apply(next: { h: number; s: number; v: number }) {
    hsv = next;
    hexText = hsvToHex(next.h, next.s, next.v);
    lastHex = hexText;
    onchange(withAlpha(hexText, parts.alpha));
  }
  function track(node: HTMLElement, read: (e: PointerEvent, r: DOMRect) => void) {
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      node.setPointerCapture(e.pointerId);
      read(e, node.getBoundingClientRect());
    };
    const move = (e: PointerEvent) => {
      if (node.hasPointerCapture(e.pointerId)) read(e, node.getBoundingClientRect());
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    return {
      destroy() {
        node.removeEventListener('pointerdown', down);
        node.removeEventListener('pointermove', move);
      },
    };
  }
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const square = (node: HTMLElement) =>
    track(node, (e, r) =>
      apply({
        h: hsv.h,
        s: clamp01((e.clientX - r.left) / r.width),
        v: 1 - clamp01((e.clientY - r.top) / r.height),
      }),
    );
  const hueStrip = (node: HTMLElement) =>
    track(node, (e, r) => apply({ ...hsv, h: clamp01((e.clientX - r.left) / r.width) * 360 }));
  function squareKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.1 : 0.01;
    let { s, v } = hsv;
    switch (event.key) {
      case 'ArrowLeft':
        s -= step;
        break;
      case 'ArrowRight':
        s += step;
        break;
      case 'ArrowDown':
        v -= step;
        break;
      case 'ArrowUp':
        v += step;
        break;
      default:
        return;
    }
    event.preventDefault();
    apply({ h: hsv.h, s: clamp01(s), v: clamp01(v) });
  }
  function hueKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 10 : 1;
    let h = hsv.h;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        h -= step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        h += step;
        break;
      case 'Home':
        h = 0;
        break;
      case 'End':
        h = 360;
        break;
      default:
        return;
    }
    event.preventDefault();
    apply({ ...hsv, h: Math.max(0, Math.min(360, h)) });
  }
  function typed(text: string) {
    hexText = text;
    const hex = text.startsWith('#') ? text : `#${text}`;
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      hsv = hexToHsv(hex);
      lastHex = hex.toLowerCase();
      onchange(withAlpha(hex.toLowerCase(), parts.alpha));
    }
  }
</script>

<div class="grid gap-3">
  <div class="flex flex-wrap items-center gap-2">
    {#each palette as c (c)}
      <button
        type="button"
        aria-label={c}
        onclick={() => onchange(withAlpha(c, parts.alpha))}
        style:background={c}
        class="size-7 rounded-full border border-white/15 transition {parts.hex === c
          ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950'
          : 'opacity-85 hover:opacity-100'}"
      ></button>
    {/each}
    <Popover.Root bind:open>
      <Popover.Trigger
        aria-label="Custom colour"
        style="background: {RAINBOW}"
        class="grid size-7 place-items-center overflow-hidden rounded-full border-0 p-0 text-white transition {custom
          ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950'
          : 'opacity-85 hover:opacity-100'}"
      >
        <Pipette
          size={14}
          strokeWidth={2.5}
          class="drop-shadow-[0_0_2px_rgb(0_0_0/.9)]"
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="end"
          class="z-50 grid w-60 gap-3 rounded-xl bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-border outline-none"
        >
          <div
            use:square
            role="slider"
            tabindex="0"
            aria-label="Saturation and brightness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
            onkeydown={squareKey}
            class="relative h-36 cursor-crosshair touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style="background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl({hsv.h} 100% 50%)"
          >
            <span
              class="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style:left="{hsv.s * 100}%"
              style:top="{(1 - hsv.v) * 100}%"
            ></span>
          </div>
          <div
            use:hueStrip
            role="slider"
            tabindex="0"
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            onkeydown={hueKey}
            class="relative h-3 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style="background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
          >
            <span
              class="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style:left="{(hsv.h / 360) * 100}%"
              style:background="hsl({hsv.h} 100% 50%)"
            ></span>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="size-8 shrink-0 rounded-md ring-1 ring-border"
              style:background={parts.hex}
            ></span>
            <Input
              aria-label="Hex colour"
              value={hexText}
              maxlength={7}
              class="h-8 font-mono text-xs uppercase"
              oninput={(e) => typed(e.currentTarget.value.trim())}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>
  <div class="flex items-center gap-3">
    <Slider
      type="single"
      class="flex-1"
      value={Math.round(parts.alpha * 100)}
      min={0}
      max={100}
      step={1}
      onValueChange={(v) => onchange(withAlpha(parts.hex, v / 100))}
    />
    <span class="w-10 text-right text-xs tabular-nums text-muted-foreground"
      >{Math.round(parts.alpha * 100)}%</span
    >
  </div>
</div>

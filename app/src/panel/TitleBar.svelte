<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import Copy from '@lucide/svelte/icons/copy';
  import Minus from '@lucide/svelte/icons/minus';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import Wordmark from './Wordmark.svelte';

  type Platform = 'windows' | 'macos' | 'linux';

  // macOS draws its own traffic lights; the header only reserves their room (px).
  const LAYOUT = {
    windows: {
      lightsInset: 0,
      buttons: true,
      button: 'h-full w-11 text-muted-foreground',
      close: 'hover:bg-[#e81123] hover:text-white',
    },
    linux: {
      lightsInset: 0,
      buttons: true,
      button: 'my-auto mr-1.5 size-5 rounded-full bg-white/[.06] text-muted-foreground',
      close: 'hover:bg-destructive hover:text-white',
    },
    macos: { lightsInset: 76, buttons: false, button: '', close: '' },
  } satisfies Record<Platform, unknown>;

  const platform: Platform = /Mac/.test(navigator.userAgent)
    ? 'macos'
    : /Windows/.test(navigator.userAgent)
      ? 'windows'
      : 'linux';
  const layout = LAYOUT[platform];

  const appWindow = getCurrentWindow();
  let maximized = $state(false);
  let snapHover = $state(false);
  let maximizeButton: HTMLButtonElement | undefined = $state();

  // Windows draws the Snap Layouts flyout only over a native hit target, so Rust gets the button's pixel rect.
  function placeSnapTarget() {
    if (platform !== 'windows' || !maximizeButton) {
      return;
    }
    const rect = maximizeButton.getBoundingClientRect();
    const scale = window.devicePixelRatio;
    void invoke('panel_snap_button', {
      x: Math.round(rect.x * scale),
      y: Math.round(rect.y * scale),
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
    }).catch(() => {});
  }

  $effect(() => {
    let alive = true;
    const unlisten: (() => void)[] = [];
    const sync = () => {
      placeSnapTarget();
      return appWindow
        .isMaximized()
        .then((value) => {
          if (alive) {
            maximized = value;
          }
        })
        .catch(() => {});
    };
    const keep = (stop: () => void) => {
      if (alive) {
        unlisten.push(stop);
      } else {
        stop();
      }
    };
    void sync();
    void appWindow.onResized(sync).then(keep);
    void appWindow
      .listen<boolean>('panel-snap-hover', (event) => (snapHover = event.payload))
      .then(keep);
    return () => {
      alive = false;
      unlisten.forEach((stop) => stop());
    };
  });

  const base =
    'grid place-items-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring hover:bg-white/[.06] hover:text-foreground';
</script>

<header
  data-tauri-drag-region
  style:padding-left="{layout.lightsInset || 12}px"
  class="flex h-9 shrink-0 select-none items-center justify-between bg-[var(--canvas-surface)] text-xs text-muted-foreground"
>
  <Wordmark />
  <!-- Marks non-release builds in the empty middle of the bar; Vite drops the block from release bundles. -->
  {#if import.meta.env.DEV}
    <svg
      data-dev-band
      aria-hidden="true"
      class="pointer-events-none mx-6 h-full min-w-0 flex-1"
    >
      <defs>
        <pattern
          id="dev-band-stripes"
          width="12"
          height="12"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect
            width="6"
            height="12"
            fill="#d9a441"
            fill-opacity="0.08"
          />
        </pattern>
        <linearGradient id="dev-band-fade">
          <stop
            offset="0"
            stop-color="white"
            stop-opacity="0"
          />
          <stop
            offset="0.2"
            stop-color="white"
          />
          <stop
            offset="0.8"
            stop-color="white"
          />
          <stop
            offset="1"
            stop-color="white"
            stop-opacity="0"
          />
        </linearGradient>
        <mask id="dev-band-mask">
          <rect
            width="100%"
            height="100%"
            fill="url(#dev-band-fade)"
          />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="url(#dev-band-stripes)"
        mask="url(#dev-band-mask)"
      />
    </svg>
  {/if}
  {#if layout.buttons}
    <div class="flex h-full">
      <button
        type="button"
        aria-label="Minimize"
        onclick={() => void appWindow.minimize()}
        class="{base} {layout.button}"><Minus size={15} /></button
      >
      <button
        bind:this={maximizeButton}
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onclick={() => void appWindow.toggleMaximize()}
        class="{base} {layout.button} {snapHover ? 'bg-white/[.06] text-foreground' : ''}"
        >{#if maximized}<Copy size={13} />{:else}<Square size={13} />{/if}</button
      >
      <button
        type="button"
        aria-label="Close"
        onclick={() => void appWindow.close()}
        class="{base} {layout.button} {layout.close}"><X size={16} /></button
      >
    </div>
  {/if}
</header>

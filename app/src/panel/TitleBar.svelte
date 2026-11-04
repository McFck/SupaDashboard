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
  class="relative isolate flex h-9 shrink-0 select-none items-center justify-between bg-[var(--canvas-surface)] text-xs text-muted-foreground"
>
  <!-- Marks non-release builds; Vite drops the block from release bundles. -->
  {#if import.meta.env.DEV}
    <svg
      data-dev-band
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 -z-10 size-full"
    >
      <defs>
        <pattern
          id="dev-band-stripes"
          width="16"
          height="16"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect
            width="8"
            height="16"
            fill="#d9a441"
            fill-opacity="0.07"
          />
        </pattern>
        <pattern
          id="dev-band-wrenches"
          width="72"
          height="36"
          patternUnits="userSpaceOnUse"
        >
          <path
            transform="translate(28 11) scale(0.58)"
            fill="#a39a91"
            fill-opacity="0.16"
            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"
          />
        </pattern>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="url(#dev-band-stripes)"
      />
      <rect
        width="100%"
        height="100%"
        fill="url(#dev-band-wrenches)"
      />
    </svg>
  {/if}
  <Wordmark />
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

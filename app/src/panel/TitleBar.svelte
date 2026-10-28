<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import Copy from '@lucide/svelte/icons/copy';
  import Minus from '@lucide/svelte/icons/minus';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';

  const appWindow = getCurrentWindow();
  let title = $state('');
  let maximized = $state(false);

  $effect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    const sync = () =>
      appWindow
        .isMaximized()
        .then((value) => {
          if (alive) {
            maximized = value;
          }
        })
        .catch(() => {});
    void appWindow.title().then((value) => {
      if (alive) {
        title = value;
      }
    });
    void sync();
    void appWindow.onResized(sync).then((stop) => {
      if (alive) {
        unlisten = stop;
      } else {
        stop();
      }
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  });

  const button =
    'grid h-full w-11 place-items-center text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
</script>

<header
  data-tauri-drag-region
  class="flex h-8 shrink-0 select-none items-center justify-between bg-[var(--canvas-surface)] pl-3 text-xs text-muted-foreground"
>
  <span class="pointer-events-none truncate">{title}</span>
  <div class="flex h-full">
    <button
      type="button"
      aria-label="Minimize"
      onclick={() => void appWindow.minimize()}
      class="{button} hover:bg-white/[.06] hover:text-foreground"><Minus size={15} /></button
    >
    <button
      type="button"
      aria-label={maximized ? 'Restore' : 'Maximize'}
      onclick={() => void appWindow.toggleMaximize()}
      class="{button} hover:bg-white/[.06] hover:text-foreground"
      >{#if maximized}<Copy size={13} />{:else}<Square size={13} />{/if}</button
    >
    <button
      type="button"
      aria-label="Close"
      onclick={() => void appWindow.close()}
      class="{button} hover:bg-[#e81123] hover:text-white"><X size={16} /></button
    >
  </div>
</header>

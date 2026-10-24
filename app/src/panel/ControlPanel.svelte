<script lang="ts">
  import { Window } from '@tauri-apps/api/window';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Settings from '@lucide/svelte/icons/settings';
  import Puzzle from '@lucide/svelte/icons/puzzle';
  import Store from '@lucide/svelte/icons/store';
  import { Button } from '$lib/components/ui/button';
  import { Hint } from '$lib/components/ui/tooltip';
  import LayoutPage from './LayoutPage.svelte';
  import PluginsPage from './PluginsPage.svelte';
  import SettingsPage from './SettingsPage.svelte';
  import MarketPage from './MarketPage.svelte';
  import ConfirmationHost from '$lib/components/ui/confirmation/ConfirmationHost.svelte';
  import { confirmationState } from '$lib/components/ui/confirmation/confirm.svelte';
  import { frame, saveFrame } from './ui/preferences.svelte';
  import { SIDEBAR_RAIL, SIDEBAR_MIN, SIDEBAR_MAX, sidebarWidth } from './ui/frame';

  type Page = 'layout' | 'settings' | 'plugins' | 'market';
  let page = $state<Page>('layout');
  let resizing = $state<{ x: number; width: number } | null>(null);
  const collapsed = $derived(frame.sidebarWidth === SIDEBAR_RAIL);
  const confirmationActive = $derived(confirmationState.current !== null);
  function moveResize(e: PointerEvent) {
    if (resizing) frame.sidebarWidth = sidebarWidth(resizing.width + e.clientX - resizing.x);
  }
  function stopResize() { if (resizing) { resizing = null; saveFrame(); } }
  function resizeKey(e: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    frame.sidebarWidth = e.key === 'Home' ? SIDEBAR_RAIL : e.key === 'End' ? SIDEBAR_MAX
      : e.key === 'ArrowLeft' ? frame.sidebarWidth <= SIDEBAR_MIN ? SIDEBAR_RAIL : sidebarWidth(frame.sidebarWidth - 16)
      : collapsed ? SIDEBAR_MIN : sidebarWidth(frame.sidebarWidth + 16);
    saveFrame();
  }
  const NAV: { id: Page; label: string; icon: typeof Monitor }[] = [
    { id: 'layout', label: 'Layout', icon: LayoutGrid }, { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'plugins', label: 'Plugins', icon: Puzzle }, { id: 'market', label: 'Market', icon: Store },
  ];

  // Mirror the dashboard's visibility (the tray can change it too).
  let visible = $state<boolean | null>(null);
  $effect(() => {
    let alive = true;
    const read = () => Window.getByLabel('main').then(w => w?.isVisible()).then(v => { if (alive) visible = v ?? null; }).catch(() => {});
    read();
    const t = setInterval(read, 800);
    return () => { alive = false; clearInterval(t); };
  });
  async function toggle() {
    const w = await Window.getByLabel('main');
    if (!w) return;
    if (visible) await w.hide(); else await w.show();
    visible = await w.isVisible();
  }
</script>

<svelte:window onpointermove={moveResize} onpointerup={stopResize} onpointercancel={stopResize} onblur={stopResize} />
<div inert={confirmationActive} class="flex h-full min-h-0 min-w-0 overflow-hidden bg-[var(--canvas-surface)] text-foreground">
  <nav aria-label="Main navigation" style:width="{frame.sidebarWidth}px" class="relative flex min-h-0 shrink-0 flex-col bg-[var(--canvas-surface)]">
    <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto py-3">
    <div class="relative grid h-10 shrink-0 grid-cols-[64px_minmax(0,1fr)] items-center">
      <Hint text={visible ? 'Hide dashboard' : 'Show dashboard'} side="right">
        {#snippet children(props)}
          <Button {...props} size="icon-lg" variant="ghost" aria-label={visible ? 'Hide dashboard' : 'Show dashboard'} aria-pressed={!!visible}
            disabled={visible == null} onclick={toggle} class="h-10 w-12 justify-self-center {visible ? 'text-foreground' : 'text-muted-foreground'}">
            {#if visible}<Eye class="size-[17px]" />{:else}<EyeOff class="size-[17px]" />{/if}
          </Button>
        {/snippet}
      </Hint>
      <span class="absolute left-14 right-2 min-w-0 truncate text-[15px] font-semibold tracking-tight" class:invisible={collapsed} aria-hidden={collapsed}>SupaDashboard</span>
    </div>
    {#each NAV as n (n.id)}
          <Hint text={collapsed ? n.label : undefined} side="right">
          {#snippet children(props)}
          <button {...props} type="button" onclick={() => (page = n.id)} aria-label={n.label} aria-current={page === n.id ? 'page' : undefined}
            class="relative mx-2 grid h-10 shrink-0 grid-cols-[48px_minmax(0,1fr)] items-center rounded-lg text-left text-[15px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring
              {page === n.id ? 'bg-white/[.08] text-foreground' : 'text-muted-foreground hover:bg-white/[.04] hover:text-foreground'}">
            <span class="flex h-10 w-12 items-center justify-center"><n.icon size={17} class="shrink-0" /></span>
            <span class="absolute left-12 right-2 min-w-0 truncate" class:invisible={collapsed} aria-hidden={collapsed}>{n.label}</span>
          </button>
          {/snippet}
          </Hint>
    {/each}
    </div>
    <button type="button" aria-label="Resize navigation"
      onpointerdown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); resizing = { x: e.clientX, width: frame.sidebarWidth }; }} onkeydown={resizeKey}
      class="absolute bottom-0 -right-3 top-2 z-20 w-2 cursor-col-resize touch-none bg-transparent outline-none hover:bg-primary/35 focus-visible:bg-primary/35"></button>
  </nav>
  <main class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
    <div class="absolute bottom-0 left-2 right-0 top-2 min-h-0 min-w-0 overflow-hidden rounded-tl-xl border-l border-t border-[#262626] bg-[#171717]">
      <div class="absolute inset-0 min-h-0 min-w-0" style:display={page === 'layout' ? undefined : 'none'} class:pointer-events-none={page !== 'layout'}
        inert={page !== 'layout'} aria-hidden={page !== 'layout'}>
        <LayoutPage active={page === 'layout'} />
      </div>
      {#if page !== 'layout'}
        {#key page}
          <div class="absolute inset-0 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
            {#if page === 'settings'}<SettingsPage />
            {:else if page === 'plugins'}<PluginsPage />
            {:else}<MarketPage />{/if}
          </div>
        {/key}
      {/if}
    </div>
  </main>
</div>
<ConfirmationHost />

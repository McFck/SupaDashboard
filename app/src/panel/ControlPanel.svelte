<script lang="ts">
  import { isTauri } from '@tauri-apps/api/core';
  import { Window } from '@tauri-apps/api/window';
  import { toast } from 'svelte-sonner';
  import { setDashboardShown } from '../platform/window';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Settings from '@lucide/svelte/icons/settings';
  import Puzzle from '@lucide/svelte/icons/puzzle';
  import Store from '@lucide/svelte/icons/store';
  import { Button } from '$lib/components/ui/button';
  import { Hint } from '$lib/components/ui/tooltip';
  import LayoutPage from '../features/layout/ui/LayoutPage.svelte';
  import PluginsPage from '../features/plugins/ui/PluginsPage.svelte';
  import SettingsPage from '../features/settings/SettingsPage.svelte';
  import MarketPage from '../features/plugins/ui/MarketPage.svelte';
  import { PluginFileIntake } from '../features/plugins/file-intake';
  import { promptForPluginPermissions } from '../features/plugins/permission-consent';
  import ConfirmationHost from '$lib/components/ui/confirmation/ConfirmationHost.svelte';
  import { confirmationState } from '$lib/components/ui/confirmation/confirm.svelte';
  import TitleBar from './TitleBar.svelte';
  import { SIDEBAR_RAIL } from './ui/frame';

  type Page = 'layout' | 'settings' | 'plugins' | 'market';
  let page = $state<Page>('layout');
  let navDirection = $state<'up' | 'down' | null>(null);
  let pluginId = $state<string | null>(null);
  const confirmationActive = $derived(confirmationState.current !== null);
  const NAV: { id: Page; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'layout', label: 'Layout', icon: LayoutGrid },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'plugins', label: 'Plugins', icon: Puzzle },
    { id: 'market', label: 'Market', icon: Store },
  ];
  const activeNavIndex = $derived(
    Math.max(
      0,
      NAV.findIndex((item) => item.id === page),
    ),
  );
  const pageEnterClass = $derived(
    navDirection === 'down'
      ? 'panel-page-enter-down'
      : navDirection === 'up'
        ? 'panel-page-enter-up'
        : '',
  );

  function navigate(next: Page) {
    if (next === page) {
      if (next === 'plugins') {
        pluginId = null;
      }
      return;
    }
    const prevIndex = NAV.findIndex((item) => item.id === page);
    const nextIndex = NAV.findIndex((item) => item.id === next);
    navDirection = nextIndex >= prevIndex ? 'down' : 'up';
    page = next;
    if (next === 'plugins') {
      pluginId = null;
    }
  }

  $effect(promptForPluginPermissions);

  $effect(() => {
    if (!isTauri()) {
      return;
    }
    const intake = new PluginFileIntake();
    return () => intake.destroy();
  });

  // Mirror the dashboard's visibility (the tray can change it too).
  let visible = $state<boolean | null>(null);
  let visibilityRevision = 0;
  $effect(() => {
    let alive = true;
    const read = () => {
      const revision = ++visibilityRevision;
      return Window.getByLabel('main')
        .then((w) => w?.isVisible())
        .then((v) => {
          if (alive && revision === visibilityRevision) {
            visible = v ?? null;
          }
        })
        .catch(() => {});
    };
    read();
    const t = setInterval(read, 800);
    return () => {
      alive = false;
      clearInterval(t);
    };
  });
  async function toggle() {
    try {
      const revision = ++visibilityRevision;
      const w = await Window.getByLabel('main');
      if (!w) {
        return;
      }
      await setDashboardShown(!visible);
      const next = await w.isVisible();
      if (revision === visibilityRevision) {
        visible = next;
      }
    } catch (error) {
      console.error(error);
      toast.error('Dashboard visibility failed');
    }
  }
</script>

<div
  inert={confirmationActive}
  class="grain flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--canvas-surface)] text-foreground"
>
  {#if isTauri()}<TitleBar />{/if}
  <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <nav
      aria-label="Main navigation"
      style:width="{SIDEBAR_RAIL}px"
      class="relative flex min-h-0 shrink-0 flex-col bg-[var(--canvas-surface)]"
    >
      <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto py-3">
        <div class="relative grid h-10 shrink-0 grid-cols-[56px_minmax(0,1fr)] items-center">
          <Hint
            text={visible ? 'Hide dashboard' : 'Show dashboard'}
            side="right"
          >
            {#snippet children(props)}
              <Button
                {...props}
                size="icon-lg"
                variant="ghost"
                aria-label={visible ? 'Hide dashboard' : 'Show dashboard'}
                aria-pressed={!!visible}
                disabled={visible == null}
                onclick={toggle}
                class="ml-2 h-10 w-12 justify-self-start {visible
                  ? 'text-foreground'
                  : 'text-muted-foreground'}"
              >
                {#if visible}<Eye class="size-[17px]" />{:else}<EyeOff class="size-[17px]" />{/if}
              </Button>
            {/snippet}
          </Hint>
        </div>
        <div class="relative flex flex-col gap-1">
          <span
            aria-hidden="true"
            style:transform="translateY({activeNavIndex * 44}px)"
            class="panel-nav-indicator pointer-events-none absolute top-0 left-2 h-10 w-12 rounded-lg bg-white/[.08]"
          >
            <span
              class="absolute top-1/2 -left-2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
            ></span>
          </span>
          {#each NAV as n (n.id)}
            <Hint
              text={n.label}
              side="right"
            >
              {#snippet children(props)}
                <button
                  {...props}
                  type="button"
                  onclick={() => navigate(n.id)}
                  aria-label={n.label}
                  aria-current={page === n.id ? 'page' : undefined}
                  class="relative ml-2 grid h-10 w-12 shrink-0 place-items-center rounded-lg text-left text-[15px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring
                {page === n.id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:bg-white/[.04] hover:text-foreground'}"
                >
                  <span class="flex h-10 w-12 items-center justify-center"
                    ><n.icon
                      size={17}
                      class="shrink-0"
                    /></span
                  >
                </button>
              {/snippet}
            </Hint>
          {/each}
        </div>
      </div>
    </nav>
    <main class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        class="absolute bottom-0 left-2 right-0 top-2 min-h-0 min-w-0 overflow-hidden rounded-tl-xl border-t border-l border-border bg-background"
      >
        <div
          class="absolute inset-0 min-h-0 min-w-0 {page === 'layout'
            ? pageEnterClass
            : 'invisible pointer-events-none opacity-0'}"
          inert={page !== 'layout'}
          aria-hidden={page !== 'layout'}
        >
          <LayoutPage
            active={page === 'layout'}
            onopenplugin={(id) => {
              pluginId = id;
              navigate('plugins');
            }}
          />
        </div>
        {#if page !== 'layout'}
          {#key page}
            <div
              class="absolute inset-0 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] {pageEnterClass}"
            >
              {#if page === 'settings'}<SettingsPage />
              {:else if page === 'plugins'}<PluginsPage bind:selected={pluginId} />
              {:else}<MarketPage
                  onopen={(id) => {
                    pluginId = id;
                    navigate('plugins');
                  }}
                />{/if}
            </div>
          {/key}
        {/if}
      </div>
    </main>
  </div>
</div>
<ConfirmationHost />

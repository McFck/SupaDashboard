<script lang="ts">
  import Boxes from '@lucide/svelte/icons/boxes';
  import { tick } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { badgeVariants } from '$lib/components/ui/badge/badge.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { Hint } from '$lib/components/ui/tooltip';
  import Icon from '../../controls/ui/Icon.svelte';
  import { nativePlugins, pluginInfo, setPluginEnabled } from '../lifecycle';
  import { applets } from '../registry';
  import Section from '../../../panel/ui/Section.svelte';
  import { reviewPluginPermissions } from '../permission-consent';
  import PluginAuthor from './PluginAuthor.svelte';
  import PluginPage from './PluginPage.svelte';
  let { selected = $bindable(null) }: { selected: string | null } = $props();
  let drill = $state<'in' | 'out' | null>(null);
  let root = $state<HTMLElement>();
  let savedScroll = 0;
  const packages = $derived([...nativePlugins.values()].filter((p) => !p.consent));
  const pending = $derived([...nativePlugins.values()].filter((p) => p.consent));
  const appletPlugins = $derived(new Set([...applets.values()].map((applet) => applet.plugin)));
  let changing = $state(false);
  const plugin = $derived(
    selected && packages.some((p) => p.id === selected) ? pluginInfo(selected) : undefined,
  );
  const listMotion = $derived(drill === 'out' ? 'panel-drill-out' : '');
  const detailMotion = $derived(drill === 'in' ? 'panel-drill-in' : '');

  function scrollHost() {
    return root?.parentElement ?? null;
  }

  function openPlugin(id: string) {
    const host = scrollHost();
    savedScroll = host?.scrollTop ?? 0;
    drill = 'in';
    selected = id;
    if (host) {
      host.scrollTop = 0;
    }
  }

  function closePlugin() {
    drill = 'out';
    selected = null;
    void tick().then(() => {
      const host = scrollHost();
      if (host) {
        host.scrollTop = savedScroll;
      }
    });
  }

  async function setEnabled(id: string, enabled: boolean) {
    if (changing) {
      return;
    }
    changing = true;
    try {
      await setPluginEnabled(id, enabled);
    } catch (error) {
      console.error(error);
      toast.error('Could not change plugin state');
    } finally {
      changing = false;
    }
  }
</script>

{#if plugin}
  <div
    bind:this={root}
    class={detailMotion}
  >
    <PluginPage
      {plugin}
      onback={closePlugin}
    />
  </div>
{:else}
  <div
    bind:this={root}
    class="mx-auto grid max-w-[740px] grid-cols-1 gap-10 px-6 py-9 {listMotion}"
  >
    <h1 class="font-display text-xl font-semibold tracking-wide">Plugins</h1>
    <Section title="Installed">
      <div class="grid grid-cols-1 gap-2">
        {#each pending as p (p.id)}
          <div class="flex items-center gap-3 rounded-xl bg-white/[.03] px-3 py-2">
            <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-white/[.06]">
              <Icon
                name="Puzzle"
                size={20}
              />
            </span>
            <div class="grid min-w-0 flex-1">
              <span class="text-base font-medium wrap-anywhere">{p.id}</span>
              <PluginAuthor
                class="text-xs text-muted-foreground"
                trust={p.trust}
              />
            </div>
            <span class="text-xs text-muted-foreground tabular-nums">{p.version}</span>
            <button
              type="button"
              class={badgeVariants({ variant: 'destructive' })}
              aria-label={`New permissions for ${p.id}`}
              onclick={() => reviewPluginPermissions(p)}
            >
              New permissions
            </button>
          </div>
        {/each}
        {#each packages as listed (listed.id)}
          {@const p = pluginInfo(listed.id) ?? { id: listed.id, title: listed.id }}
          <div
            class="flex items-center gap-3 rounded-xl bg-white/[.03] pr-3 transition-colors hover:bg-accent"
          >
            <button
              type="button"
              onclick={() => openPlugin(p.id)}
              class="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-white/[.06]"
                ><Icon
                  name={p.icon ?? 'Puzzle'}
                  size={20}
                /></span
              >
              <div class="grid min-w-0 flex-1 gap-y-0.5">
                <div class="flex min-w-0 items-start gap-2">
                  <p class="min-w-0 text-base leading-snug font-medium wrap-anywhere">
                    {p.title}
                  </p>
                  {#if appletPlugins.has(p.id)}
                    <Hint text="Applet">
                      {#snippet children(props)}
                        <span
                          {...props}
                          tabindex="-1"
                          role="img"
                          aria-label="Applet"
                          class="mt-0.5 inline-flex shrink-0 text-muted-foreground"
                        >
                          <Boxes class="size-4" />
                        </span>
                      {/snippet}
                    </Hint>
                  {/if}
                </div>
                <PluginAuthor
                  class="justify-self-start text-xs leading-normal text-muted-foreground"
                  trust={listed.trust}
                />
                {#if p.description}
                  <p
                    class="mt-[calc(var(--spacing)*0.2)] max-w-[65ch] text-xs leading-normal wrap-anywhere text-muted-foreground"
                  >
                    {p.description}
                  </p>
                {/if}
              </div>
              <span class="shrink-0 text-xs text-muted-foreground tabular-nums"
                >{listed.version}</span
              >
            </button>
            {#if listed.trust !== 'dev'}
              <Switch
                aria-label={`Enable ${p.title}`}
                checked={p.default || listed.enabled}
                disabled={p.default || changing}
                onCheckedChange={(enabled) => setEnabled(p.id, enabled)}
              />
            {/if}
          </div>
        {/each}
      </div>
    </Section>
  </div>
{/if}

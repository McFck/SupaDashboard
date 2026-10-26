<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import Icon from '../../controls/ui/Icon.svelte';
  import { pluginState, setPluginEnabled, skins, suggestionsOf } from '../registry';
  import type { Param, Plugin } from '../contracts';
  import ParamField from './ParamField.svelte';
  import { commit } from '../../layout/history.svelte';
  import { currentRuntime } from '../../../app/runtime.svelte';
  import { resolveSkinConfig, validSkinParam } from '../../skins/definition';
  import { settings } from '../../settings/state.svelte';
  import Row from '../../../panel/ui/Row.svelte';
  import Section from '../../../panel/ui/Section.svelte';
  let { plugin, onback }: { plugin: Plugin; onback: () => void } = $props();
  const pluginSkins = $derived([...skins.values()].filter((skin) => skin.plugin === plugin.id));
  let removing = $state(false);
  function setSkinSetting(skin: (typeof pluginSkins)[number], param: Param, value: unknown) {
    const current = settings.skinSettings[skin.id] ?? {};
    const previous = resolveSkinConfig(skin, current);
    if (!validSkinParam(param, value, previous)) return;
    const next = { ...current, [param.key]: value };
    const resolved = { ...previous, [param.key]: value };
    for (const dependent of skin.settings ?? []) {
      if (
        dependent.key === param.key ||
        validSkinParam(dependent, resolved[dependent.key], resolved)
      )
        continue;
      const options = suggestionsOf(dependent, resolved);
      const fallback =
        options?.find((option) => Object.is(option.value, dependent.default))?.value ??
        options?.[0]?.value;
      if (fallback === undefined) {
        delete next[dependent.key];
        delete resolved[dependent.key];
      } else {
        next[dependent.key] = fallback;
        resolved[dependent.key] = fallback;
      }
    }
    if (
      Object.keys(next).every((key) => Object.is(next[key], current[key])) &&
      Object.keys(current).every((key) => Object.is(current[key], next[key]))
    )
      return;
    commit(`Change ${skin.title} ${param.label}`);
    settings.skinSettings = { ...settings.skinSettings, [skin.id]: next };
    currentRuntime()?.updateSkinConfig(skin.id, settings.skinSettings[skin.id]);
  }
  function date(value?: string) {
    return value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
      : '—';
  }
  function size(value?: number | string) {
    if (typeof value !== 'number') return value ?? '—';
    if (value < 1024) return `${value} B`;
    return value < 1024 * 1024
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  async function remove() {
    if (removing) return;
    removing = true;
    const id = plugin.id;
    try {
      if (
        !(await confirm({ title: `Remove ${plugin.title}?`, action: 'Remove', destructive: true }))
      )
        return;
      if (!$pluginState.installed[id] || $pluginState.uninstalled.includes(id)) return;
      await setPluginEnabled(id, false);
    } catch (error) {
      toast.error(String(error));
    } finally {
      removing = false;
    }
  }
</script>

<div class="mx-auto grid max-w-[740px] gap-8 px-6 py-9">
  <Button
    variant="ghost"
    size="sm"
    class="w-fit"
    onclick={onback}><ArrowLeft />Plugins</Button
  >
  <div class="flex items-center gap-4">
    <span class="grid size-16 shrink-0 place-items-center rounded-2xl border bg-accent"
      ><Icon
        name={plugin.icon ?? 'Puzzle'}
        size={30}
      /></span
    >
    <h1 class="text-2xl font-semibold tracking-tight">{plugin.title}</h1>
  </div>
  {#if plugin.description}<p class="text-[15px] leading-relaxed text-muted-foreground">
      {plugin.description}
    </p>{/if}
  <Section>
    <Row label="Author"><span class="text-sm">{plugin.author ?? '—'}</span></Row>
    <Row label="Version"><span class="text-sm tabular-nums">{plugin.version ?? '—'}</span></Row>
    <Row label="Last update"><span class="text-sm">{date(plugin.updated)}</span></Row>
    <Row label="Installed"
      ><span class="text-sm">{date($pluginState.installed[plugin.id])}</span></Row
    >
    <Row label="Size"><span class="text-sm tabular-nums">{size(plugin.size)}</span></Row>
  </Section>
  {#if pluginSkins.length}
    <Section title="Skins">
      {#each pluginSkins as skin (skin.id)}
        <Row label={skin.title}>
          <div class="flex flex-wrap justify-end gap-1.5">
            {#each skin.alters ?? [] as alteration (alteration)}
              <Badge variant="secondary">Changes {alteration}</Badge>
            {/each}
          </div>
        </Row>
      {/each}
    </Section>
    {#each pluginSkins as skin (skin.id)}
      {#if skin.settings?.length}
        {@const values = resolveSkinConfig(skin, settings.skinSettings[skin.id] ?? {})}
        <Section title={`${skin.title} settings`}>
          {#each skin.settings as param (param.key)}
            <div class="border-b py-3.5 last:border-b-0">
              <ParamField
                {param}
                args={values}
                provider={skin.plugin}
                value={values[param.key]}
                showPluginMark={false}
                onchange={(value) => setSkinSetting(skin, param, value)}
              />
            </div>
          {/each}
        </Section>
      {/if}
    {/each}
  {/if}
  {#if plugin.settings}
    {@const Settings = plugin.settings}
    <Section title="Settings"><Settings /></Section>
  {/if}
  {#if !plugin.default && !plugin.builtin}
    <Section
      ><Row label="Remove plugin">
        <Button
          variant="destructive"
          size="sm"
          disabled={removing}
          onclick={() => {
            void remove();
          }}>Remove</Button
        >
      </Row></Section
    >
  {/if}
</div>

<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Switch } from '$lib/components/ui/switch';
  import Icon from '../../controls/ui/Icon.svelte';
  import {
    actions,
    applets,
    controlTypes,
    mediaSources,
    pluginState,
    setPluginEnabled,
  } from '../registry';
  import type { Param, Plugin } from '../contracts';
  import GuideDialog from './GuideDialog.svelte';
  import ParamControl from './ParamControl.svelte';
  import SettingsIndex from './SettingsIndex.svelte';
  import { labelEdit } from '../../layout/history.svelte';
  import { nextAppletSettings, resolveAppletConfig, settingGroups } from '../../applets/definition';
  import { settings } from '../../settings/state.svelte';
  import {
    appletValues,
    withAppletValues,
    withSeparateAppletSettings,
  } from '../../settings/applet-scope';
  import { runtimeView } from '../../../app/runtime/state';
  import Row from '../../../panel/ui/Row.svelte';
  import Section from '../../../panel/ui/Section.svelte';

  let { plugin, onback }: { plugin: Plugin; onback: () => void } = $props();
  const pluginApplets = $derived(
    [...applets.values()].filter((applet) => applet.plugin === plugin.id),
  );
  /** Settings are read and written for the page being shown, which only matters when they are separate. */
  const pageId = $derived($runtimeView.activePage || settings.deck.activePage);
  const aboutId = $derived(`${plugin.id}-about`);
  const sections = $derived(
    pluginApplets.flatMap((applet) =>
      settingGroups(applet.settings).map((group) => ({
        ...group,
        id: `${applet.id}-${group.id}`,
        applet,
      })),
    ),
  );
  const owned = <T extends { plugin?: string; title: string }>(items: Iterable<T>) =>
    [...items].filter((item) => item.plugin === plugin.id).map((item) => item.title);
  const adds = $derived(
    [
      { label: 'Widgets', titles: [...owned(controlTypes.values()), ...owned(applets.values())] },
      { label: 'Actions', titles: owned(actions.values()) },
      { label: 'Media sources', titles: owned(mediaSources.values()) },
    ].filter(({ titles }) => titles.length),
  );
  let guideOpen = $state(false);
  let removing = $state(false);
  let changing = $state(false);
  async function setEnabled(enabled: boolean) {
    if (changing) {
      return;
    }
    changing = true;
    try {
      await setPluginEnabled(plugin.id, enabled);
    } catch (error) {
      console.error(error);
      toast.error('Could not change plugin state');
    } finally {
      changing = false;
    }
  }
  function setAppletSetting(applet: (typeof pluginApplets)[number], param: Param, value: unknown) {
    const entry = settings.appletSettings[applet.id];
    const next = nextAppletSettings(applet, appletValues(entry, pageId), param.key, value);
    if (!next) {
      return;
    }
    labelEdit(`Change ${applet.title} ${param.label}`);
    settings.appletSettings = {
      ...settings.appletSettings,
      [applet.id]: withAppletValues(entry, pageId, next),
    };
  }
  function setSeparate(applet: (typeof pluginApplets)[number], separate: boolean) {
    labelEdit(`Change ${applet.title} separate settings`);
    settings.appletSettings = {
      ...settings.appletSettings,
      [applet.id]: withSeparateAppletSettings(
        settings.appletSettings[applet.id],
        settings.deck.pages.map((page) => page.id),
        separate,
      ),
    };
  }
  function date(value?: string) {
    return value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
      : '—';
  }
  function size(value?: number | string) {
    if (typeof value !== 'number') {
      return value ?? '—';
    }
    if (value < 1024) {
      return `${value} B`;
    }
    return value < 1024 * 1024
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  async function remove() {
    if (removing) {
      return;
    }
    removing = true;
    const id = plugin.id;
    try {
      if (
        !(await confirm({ title: `Remove ${plugin.title}?`, action: 'Remove', destructive: true }))
      ) {
        return;
      }
      if (!$pluginState.installed[id] || $pluginState.uninstalled.includes(id)) {
        return;
      }
      await setPluginEnabled(id, false);
    } catch (error) {
      console.error(error);
      toast.error(`Could not remove ${plugin.title}`);
    } finally {
      removing = false;
    }
  }
</script>

<!-- The header is as wide as the sections; with the side index beside them, as wide as both. -->
<div class="@container">
  <div
    class="mx-auto grid gap-8 px-6 py-9 {sections.length >= 3 ? 'max-w-[940px]' : 'max-w-[740px]'}"
  >
    <Button
      variant="ghost"
      size="sm"
      class="w-fit"
      onclick={onback}><ArrowLeft />Plugins</Button
    >
    <div class="grid max-w-[740px] gap-3 {sections.length >= 3 ? '@[900px]:max-w-none' : ''}">
      <div class="flex items-center gap-4">
        <span class="grid size-16 shrink-0 place-items-center rounded-2xl border bg-accent"
          ><Icon
            name={plugin.icon ?? 'Puzzle'}
            size={30}
          /></span
        >
        <div class="grid min-w-0 flex-1 gap-1.5">
          <h1 class="font-display text-2xl font-semibold tracking-wide">{plugin.title}</h1>
          <div class="flex flex-wrap items-center gap-1.5">
            {#if plugin.version}<Badge
                variant="secondary"
                class="tabular-nums">{plugin.version}</Badge
              >{/if}
            {#if pluginApplets.length}<Badge variant="secondary">Applet</Badge>{/if}
          </div>
        </div>
        {#if plugin.guide}
          <Button
            variant="outline"
            size="sm"
            onclick={() => (guideOpen = true)}><BookOpen />How to use</Button
          >
        {/if}
        <Switch
          aria-label={`Enable ${plugin.title}`}
          checked={plugin.default || !$pluginState.uninstalled.includes(plugin.id)}
          disabled={plugin.default || changing}
          onCheckedChange={setEnabled}
        />
      </div>
      {#if plugin.author}<p class="text-sm font-medium">{plugin.author}</p>{/if}
      {#if plugin.description}<p class="text-sm leading-relaxed text-muted-foreground">
          {plugin.description}
        </p>{/if}
    </div>
    <div
      class="grid gap-8 {sections.length >= 3
        ? '@[900px]:grid-cols-[160px_minmax(0,1fr)] @[900px]:gap-10'
        : ''}"
    >
      {#if sections.length >= 3}
        <SettingsIndex items={[...sections, { id: aboutId, title: 'About' }]} />
      {/if}
      <div class="grid min-w-0 max-w-[740px] gap-8">
        {#each sections as { id, title, applet, params }, index (id)}
          {@const entry = settings.appletSettings[applet.id]}
          {@const values = resolveAppletConfig(applet, appletValues(entry, pageId))}
          <div
            {id}
            class="scroll-mt-14 @[900px]:scroll-mt-9"
          >
            <Section {title}>
              {#if sections.findIndex((section) => section.applet === applet) === index}
                <Row
                  label="Separate settings per page"
                  for={`${id}-separate`}
                >
                  <Switch
                    id={`${id}-separate`}
                    checked={entry?.separate ?? false}
                    onCheckedChange={(separate) => setSeparate(applet, separate)}
                  />
                </Row>
              {/if}
              {#each params.filter((param) => param.visible?.(values) ?? true) as param (param.key)}
                <Row
                  label={param.label}
                  for={`${id}-${param.key}`}
                >
                  <ParamControl
                    id={`${id}-${param.key}`}
                    {param}
                    args={values}
                    provider={applet.plugin}
                    value={values[param.key]}
                    showPluginMark={false}
                    onchange={(value) => setAppletSetting(applet, param, value)}
                  />
                </Row>
              {/each}
            </Section>
          </div>
        {/each}
        {#if plugin.settingsSection}
          <plugin.settingsSection />
        {/if}
        <div
          id={aboutId}
          class="scroll-mt-14 @[900px]:scroll-mt-9"
        >
          <Section title="About">
            {#each adds as { label, titles } (label)}
              <Row {label}><span class="text-right text-sm">{titles.join(', ')}</span></Row>
            {/each}
            <Row label="Last update"><span class="text-sm">{date(plugin.updated)}</span></Row>
            <Row label="Installed"
              ><span class="text-sm">{date($pluginState.installed[plugin.id])}</span></Row
            >
            <Row label="Size"><span class="text-sm tabular-nums">{size(plugin.size)}</span></Row>
            {#if !plugin.default && !plugin.builtin}
              <Row label="Remove plugin">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={removing}
                  onclick={() => {
                    void remove();
                  }}>Remove</Button
                >
              </Row>
            {/if}
          </Section>
        </div>
      </div>
    </div>
  </div>
</div>
{#if plugin.guide}
  <GuideDialog
    title={plugin.title}
    guide={plugin.guide}
    bind:open={guideOpen}
  />
{/if}

<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import {
    applets,
    nativePlugins,
    pluginState,
    removePlugin,
    setPluginEnabled,
    verifiedPlugin,
  } from '../registry';
  import type { Param, Plugin } from '../contracts';
  import { formatDate, formatSize } from './about';
  import ParamControl from './ParamControl.svelte';
  import PluginHeader from './PluginHeader.svelte';
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
  const listed = $derived(nativePlugins.get(plugin.id));
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
  async function remove() {
    if (removing) {
      return;
    }
    removing = true;
    try {
      if (
        !(await confirm({ title: `Remove ${plugin.title}?`, action: 'Remove', destructive: true }))
      ) {
        return;
      }
      await removePlugin(plugin.id);
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
      <PluginHeader
        title={plugin.title}
        icon={plugin.icon}
        badges={[...(listed ? [listed.version] : []), ...(pluginApplets.length ? ['Applet'] : [])]}
        verified={verifiedPlugin(plugin.id)}
        description={plugin.description}
        guide={plugin.guide}
      >
        <Switch
          aria-label={`Enable ${plugin.title}`}
          checked={plugin.default || !$pluginState.uninstalled.includes(plugin.id)}
          disabled={plugin.default || changing}
          onCheckedChange={setEnabled}
        />
      </PluginHeader>
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
            <Row label="Last update"><span class="text-sm">{formatDate(listed?.updated)}</span></Row
            >
            <Row label="Installed"
              ><span class="text-sm">{formatDate($pluginState.installed[plugin.id])}</span></Row
            >
            <Row label="Size"
              ><span class="text-sm tabular-nums">{formatSize(listed?.size)}</span></Row
            >
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

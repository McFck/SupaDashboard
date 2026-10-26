<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { primaryMonitor, type Monitor } from '@tauri-apps/api/window';
  import Star from '@lucide/svelte/icons/star';
  import PanelsTopLeft from '@lucide/svelte/icons/panels-top-left';
  import { Button } from '$lib/components/ui/button';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { monitors } from '../display/display';
  import { skins } from '../plugins/registry';
  import { settings } from './state.svelte';
  import { DEFAULTS } from './schema';
  import { commit } from '../layout/history.svelte';
  import Choice from '../plugins/ui/Choice.svelte';
  import { currentRuntime } from '../../app/runtime.svelte';
  import Row from '../../panel/ui/Row.svelte';
  import Section from '../../panel/ui/Section.svelte';
  import {
    buildMonitorOptions,
    CURRENT_POSITION,
    monitorSelectOptions,
  } from '../display/monitor-options';

  let screens = $state<Monitor[]>([]);
  let nativeNames = $state<unknown[]>([]);
  let primaryScreen = $state<Monitor | null>(null);
  let resetting = $state(false);
  let alive = false;
  let refreshGeneration = 0;

  const monitorOptions = $derived(buildMonitorOptions(screens, nativeNames, primaryScreen));
  const screenOptions = $derived(
    monitorSelectOptions(monitorOptions, settings.display.monitor).map((option) => ({
      ...option,
      icon: option.primary ? Star : undefined,
      iconLabel: option.primary ? 'Primary display' : undefined,
    })),
  );

  async function refreshMonitors() {
    const generation = ++refreshGeneration;
    const [monitorResult, nativeResult, primaryResult] = await Promise.allSettled([
      monitors(),
      invoke<unknown[]>('monitor_names'),
      primaryMonitor(),
    ]);
    if (!alive || generation !== refreshGeneration) return;
    screens = monitorResult.status === 'fulfilled' ? monitorResult.value : [];
    nativeNames =
      nativeResult.status === 'fulfilled' && Array.isArray(nativeResult.value)
        ? nativeResult.value
        : [];
    primaryScreen = primaryResult.status === 'fulfilled' ? primaryResult.value : null;
  }

  onMount(() => {
    alive = true;
    void refreshMonitors();
    return () => {
      alive = false;
      refreshGeneration++;
    };
  });

  async function reset() {
    if (resetting) return;
    resetting = true;
    try {
      if (!(await confirm({ title: 'Reset everything?', action: 'Reset', destructive: true })))
        return;
      commit('Reset everything');
      Object.assign(settings, structuredClone(DEFAULTS));
      for (const skin of skins.values())
        currentRuntime()?.updateSkinConfig(skin.id, settings.skinSettings[skin.id] ?? {});
    } finally {
      resetting = false;
    }
  }
</script>

<div class="mx-auto grid max-w-[740px] gap-8 px-6 py-6">
  <h1 class="text-xl font-semibold tracking-tight">Settings</h1>

  <Section title="General">
    <Row
      label="Skin"
      for="skin-choice"
    >
      <Choice
        id="skin-choice"
        class="w-56 min-w-0 max-w-full"
        value={settings.skin}
        onchange={(v) => (settings.skin = v)}
        options={[...skins.values()].map((s) => ({
          value: s.id,
          label: s.title,
          plugin: s.plugin,
          icon: s.alters?.includes('layout') ? PanelsTopLeft : undefined,
          iconHint: s.alters?.includes('layout') ? 'Changes layout' : undefined,
        }))}
      />
    </Row>
  </Section>

  <Section title="Dashboard">
    <Row
      label="Monitor"
      for="monitor-choice"
    >
      <Choice
        id="monitor-choice"
        class="w-56 min-w-0 max-w-full"
        value={settings.display.monitor ?? CURRENT_POSITION}
        onchange={(v) => {
          settings.display.monitor = v === CURRENT_POSITION ? null : v;
        }}
        onopen={() => {
          void refreshMonitors();
        }}
        options={screenOptions}
      />
    </Row>
    <Row
      label="Fullscreen"
      for="fs"
      ><Switch
        id="fs"
        bind:checked={settings.display.fullscreen}
      /></Row
    >
    <Row
      label="Always on top"
      for="always-on-top"
      ><Switch
        id="always-on-top"
        bind:checked={settings.display.alwaysOnTop}
      /></Row
    >
  </Section>

  <Section title="Advanced">
    <Row label="Reset everything">
      <Button
        variant="destructive"
        size="sm"
        disabled={resetting}
        onclick={() => {
          void reset();
        }}>Reset</Button
      >
    </Row>
  </Section>
</div>

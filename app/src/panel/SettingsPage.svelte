<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { primaryMonitor, type Monitor } from '@tauri-apps/api/window';
  import Star from '@lucide/svelte/icons/star';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { monitors } from '../core/display';
import { skins, type Param } from '../core/registry';
  import { DEFAULTS, settings } from '../core/settings.svelte';
  import { commit } from '../core/history.svelte';
  import Choice from '../editor/Choice.svelte';
import ParamField from '../editor/ParamField.svelte';
import { resolveSkinConfig, validSkinParam } from '../core/skins';
  import { currentRuntime } from '../core/runtime.svelte';
  import Row from './ui/Row.svelte';
  import Section from './ui/Section.svelte';
  import { buildMonitorOptions, CURRENT_POSITION, monitorSelectOptions } from './ui/monitor-options';

  let screens = $state<Monitor[]>([]);
  let nativeNames = $state<unknown[]>([]);
  let primaryScreen = $state<Monitor | null>(null);
  let resetting = $state(false);
  let rotationDraft = $state(String(settings.pageRotation.intervalSeconds || 30));
  let alive = false;
  let refreshGeneration = 0;

  const monitorOptions = $derived(buildMonitorOptions(screens, nativeNames, primaryScreen));
  const selectedSkin = $derived(skins.get(settings.skin));
  const resolvedSkinSettings = $derived(selectedSkin ? resolveSkinConfig(selectedSkin, settings.skinSettings[selectedSkin.id] ?? {}) : {});
  const screenOptions = $derived(monitorSelectOptions(monitorOptions, settings.display.monitor).map(option => ({
    ...option,
    icon: option.primary ? Star : undefined,
    iconLabel: option.primary ? 'Primary display' : undefined,
  })));

  async function refreshMonitors() {
    const generation = ++refreshGeneration;
    const [monitorResult, nativeResult, primaryResult] = await Promise.allSettled([
      monitors(), invoke<unknown[]>('monitor_names'), primaryMonitor(),
    ]);
    if (!alive || generation !== refreshGeneration) return;
    screens = monitorResult.status === 'fulfilled' ? monitorResult.value : [];
    nativeNames = nativeResult.status === 'fulfilled' && Array.isArray(nativeResult.value) ? nativeResult.value : [];
    primaryScreen = primaryResult.status === 'fulfilled' ? primaryResult.value : null;
  }

  onMount(() => {
    alive = true;
    void refreshMonitors();
    return () => { alive = false; refreshGeneration++; };
  });

  $effect(() => {
    rotationDraft = String(settings.pageRotation.intervalSeconds || 30);
  });

  function setPageRotation(enabled: boolean) {
    const interval = enabled ? 30 : 0;
    if (settings.pageRotation.intervalSeconds === interval) return;
    commit(enabled ? 'Enable page rotation' : 'Disable page rotation');
    settings.pageRotation.intervalSeconds = interval;
    rotationDraft = String(interval || 30);
  }

  function saveRotationInterval() {
    const interval = Number(rotationDraft);
    if (!Number.isInteger(interval) || interval < 5 || interval > 3600) {
      rotationDraft = String(settings.pageRotation.intervalSeconds || 30);
      return;
    }
    if (settings.pageRotation.intervalSeconds === interval) return;
    commit('Change page rotation interval');
    settings.pageRotation.intervalSeconds = interval;
  }

  function setSkinSetting(param: Param, value: unknown) {
    const skin = selectedSkin;
    if (!skin || !validSkinParam(param, value)) return;
    const current = settings.skinSettings[skin.id] ?? {};
    if (Object.hasOwn(current, param.key) && Object.is(current[param.key], value)) return;
    commit(`Change ${skin.title} ${param.label}`);
    settings.skinSettings = { ...settings.skinSettings, [skin.id]: { ...current, [param.key]: value } };
    currentRuntime()?.updateSkinConfig(skin.id, settings.skinSettings[skin.id]);
  }

  async function reset() {
    if (resetting) return;
    resetting = true;
    try {
      if (!await confirm({ title: 'Reset everything?', action: 'Reset', destructive: true })) return;
      commit('Reset everything');
      Object.assign(settings, structuredClone(DEFAULTS));
      for (const skin of skins.values()) currentRuntime()?.updateSkinConfig(skin.id, settings.skinSettings[skin.id] ?? {});
    } finally { resetting = false; }
  }
</script>

<div class="mx-auto grid max-w-[740px] gap-8 px-6 py-6">
  <h1 class="text-xl font-semibold tracking-tight">Settings</h1>

  <Section title="General">
    <Row label="Skin" for="skin-choice">
      <Choice id="skin-choice" class="w-56 min-w-0 max-w-full" value={settings.skin} onchange={v => (settings.skin = v)} options={[...skins.values()].map(s => ({ value: s.id, label: s.title, plugin: s.plugin }))} />
    </Row>
  </Section>

  {#if selectedSkin?.settings?.length}
    <Section title={selectedSkin.title}>
      {#each selectedSkin.settings as param (param.key)}
        <ParamField {param} provider={selectedSkin.plugin} value={resolvedSkinSettings[param.key]}
          onchange={value => setSkinSetting(param, value)} />
      {/each}
    </Section>
  {/if}

  <Section title="Dashboard">
    <Row label="Monitor" for="monitor-choice">
      <Choice id="monitor-choice" class="w-56 min-w-0 max-w-full" value={settings.display.monitor ?? CURRENT_POSITION}
        onchange={v => { settings.display.monitor = v === CURRENT_POSITION ? null : v; }} onopen={() => { void refreshMonitors(); }} options={screenOptions} />
    </Row>
    <Row label="Fullscreen" for="fs"><Switch id="fs" bind:checked={settings.display.fullscreen} /></Row>
    <Row label="Always on top" for="always-on-top"><Switch id="always-on-top" bind:checked={settings.display.alwaysOnTop} /></Row>
    <Row label="Auto-rotate pages" for="page-rotation">
      <Switch id="page-rotation" checked={settings.pageRotation.intervalSeconds > 0} onCheckedChange={setPageRotation} />
    </Row>
    <Row label="Interval" for="page-rotation-interval">
      <div class="flex w-36 items-center gap-2">
        <Input id="page-rotation-interval" type="number" min="5" max="3600" step="1" class="w-24"
          bind:value={rotationDraft} disabled={settings.pageRotation.intervalSeconds === 0} onchange={saveRotationInterval} />
        <span class="text-sm text-muted-foreground">sec</span>
      </div>
    </Row>
  </Section>

  <Section title="Advanced">
    <Row label="Reset everything">
      <Button variant="destructive" size="sm" disabled={resetting} onclick={() => { void reset(); }}>Reset</Button>
    </Row>
  </Section>
</div>

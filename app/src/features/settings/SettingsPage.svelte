<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { primaryMonitor, type Monitor } from '@tauri-apps/api/window';
  import Star from '@lucide/svelte/icons/star';
  import { Button } from '$lib/components/ui/button';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { monitors } from '../../platform/window';
  import { settings } from './state.svelte';
  import { DEFAULTS } from './defaults';
  import { commit } from '../layout/history.svelte';
  import Choice from '../plugins/ui/Choice.svelte';
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
  let copying = $state(false);
  let alive = false;
  let refreshGeneration = 0;

  const monitorOptions = $derived(buildMonitorOptions(screens, nativeNames, primaryScreen));
  const screenOptions = $derived(
    monitorSelectOptions(
      monitorOptions,
      settings.display.monitor,
      settings.display.monitorLabel,
    ).map((option) => ({
      ...option,
      icon: option.primary ? Star : undefined,
      iconLabel: option.primary ? 'Primary display' : undefined,
    })),
  );
  const selectedMonitor = $derived(
    monitorOptions.find(
      (option) =>
        option.value === settings.display.monitor || option.legacyName === settings.display.monitor,
    ),
  );

  function chooseMonitor(value: string) {
    settings.display.monitor = value === CURRENT_POSITION ? null : value;
    const option = monitorOptions.find((candidate) => candidate.value === value);
    // Shown while the screen is disconnected; the resolution tells same-named screens apart.
    settings.display.monitorLabel = option ? `${option.label} (${option.detail})` : null;
    commit('Choose monitor');
  }

  async function refreshMonitors() {
    const generation = ++refreshGeneration;
    const [monitorResult, nativeResult, primaryResult] = await Promise.allSettled([
      monitors(),
      invoke<unknown[]>('monitor_names'),
      primaryMonitor(),
    ]);
    if (!alive || generation !== refreshGeneration) {
      return;
    }
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

  async function copyToRelease() {
    if (!import.meta.env.DEV || copying) {
      return;
    }
    copying = true;
    try {
      if (
        !(await confirm({
          title: 'Replace release app settings?',
          action: 'Copy',
          destructive: true,
        }))
      ) {
        return;
      }
      await invoke('copy_settings_to_release');
      toast.success('Settings copied to release app');
    } catch (error) {
      toast.error(typeof error === 'string' ? error.slice(0, 120) : 'Could not copy settings');
    } finally {
      copying = false;
    }
  }

  async function reset() {
    if (resetting) {
      return;
    }
    resetting = true;
    try {
      if (!(await confirm({ title: 'Reset everything?', action: 'Reset', destructive: true }))) {
        return;
      }
      commit('Reset everything');
      Object.assign(settings, structuredClone(DEFAULTS));
    } finally {
      resetting = false;
    }
  }
</script>

<div class="mx-auto grid max-w-[740px] gap-8 px-6 py-6">
  <h1 class="font-display text-xl font-semibold tracking-wide">Settings</h1>

  <Section title="Dashboard">
    <Row
      label="Monitor"
      for="monitor-choice"
    >
      <Choice
        id="monitor-choice"
        class="w-56 min-w-0 max-w-full"
        value={selectedMonitor?.value ?? settings.display.monitor ?? CURRENT_POSITION}
        onchange={chooseMonitor}
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

  {#if import.meta.env.DEV}
    <Section title="Development">
      <Row label="Release app">
        <Button
          size="sm"
          disabled={copying}
          onclick={() => {
            void copyToRelease();
          }}
        >
          Copy settings to release app
        </Button>
      </Row>
    </Section>
  {/if}
</div>

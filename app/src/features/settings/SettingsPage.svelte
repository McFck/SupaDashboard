<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import Star from '@lucide/svelte/icons/star';
  import { Button } from '$lib/components/ui/button';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { settings } from './state.svelte';
  import { settingsSystem } from './system-state.svelte';
  import { DEFAULTS } from './defaults';
  import { commit } from '../layout/history.svelte';
  import Choice from '../plugins/ui/Choice.svelte';
  import Row from '../../panel/ui/Row.svelte';
  import Section from '../../panel/ui/Section.svelte';
  import AppUpdates from './AppUpdates.svelte';
  import { matchMonitor } from '../display/monitor-identity';
  import {
    buildMonitorOptions,
    CURRENT_POSITION,
    monitorSelectOptions,
  } from '../display/monitor-options';

  let resetting = $state(false);
  let copying = $state(false);

  const monitorOptions = $derived(
    buildMonitorOptions(
      settingsSystem.screens,
      settingsSystem.nativeNames,
      settingsSystem.primaryScreen,
    ),
  );
  const screenOptions = $derived(
    monitorSelectOptions(
      monitorOptions,
      settings.display.monitor,
      settings.display.monitorLabel,
      !settingsSystem.monitorsLoaded,
    ).map((option) => ({
      ...option,
      icon: option.primary ? Star : undefined,
      iconLabel: option.primary ? 'Primary display' : undefined,
    })),
  );
  const selectedMonitor = $derived(matchMonitor(monitorOptions, settings.display.monitor));

  function chooseMonitor(value: string) {
    settings.display.monitor = value === CURRENT_POSITION ? null : value;
    const option = monitorOptions.find((candidate) => candidate.value === value);
    // Shown while the screen is disconnected; the resolution tells same-named screens apart.
    settings.display.monitorLabel = option ? `${option.label} (${option.detail})` : null;
    commit('Choose monitor');
  }

  onMount(() => {
    void settingsSystem.refreshMonitors();
    void settingsSystem.refreshAutostart();
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
          void settingsSystem.refreshMonitors();
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
    <Row
      label="Start with Windows"
      for="autostart"
      ><Switch
        id="autostart"
        disabled={settingsSystem.autostart === undefined}
        checked={settingsSystem.autostart ?? false}
        onCheckedChange={(enabled) => {
          void settingsSystem.setAutostart(enabled);
        }}
      /></Row
    >
  </Section>

  <AppUpdates />

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

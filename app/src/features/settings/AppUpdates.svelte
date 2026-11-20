<script lang="ts">
  import { isTauri } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Row from '../../panel/ui/Row.svelte';
  import Section from '../../panel/ui/Section.svelte';
  import { settingsSystem } from './system-state.svelte';

  const native = isTauri();
  const status = $derived(settingsSystem.updateStatus);
  const busy = $derived(status.kind === 'checking' || status.kind === 'installing');

  const buttonLabel = $derived.by(() => {
    switch (status.kind) {
      case 'available':
        return `Update to ${status.version}`;
      case 'checking':
        return 'Checking for updates…';
      case 'installing':
        return 'Installing update…';
      default:
        return 'Check for updates';
    }
  });

  async function activate() {
    if (busy) {
      return;
    }
    if (status.kind !== 'available') {
      await settingsSystem.checkForUpdates(true);
      return;
    }
    await settingsSystem.installAvailableUpdate();
  }

  onMount(() => {
    if (native) {
      settingsSystem.preloadUpdates();
    }
  });
</script>

<Section title="Updates">
  <Row label={`Version ${settingsSystem.currentVersion}`}>
    <Button
      size="sm"
      disabled={!native || busy}
      onclick={activate}>{buttonLabel}</Button
    >
  </Row>
</Section>

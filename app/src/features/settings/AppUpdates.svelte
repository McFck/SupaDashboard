<script lang="ts">
  import { getVersion } from '@tauri-apps/api/app';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { version as bundledVersion } from '../../../package.json';
  import Row from '../../panel/ui/Row.svelte';
  import Section from '../../panel/ui/Section.svelte';

  type UpdateStatus =
    { kind: 'idle' | 'checking' | 'installing' } | { kind: 'available'; version: string };

  const native = isTauri();
  let currentVersion = $state(bundledVersion);
  let status = $state<UpdateStatus>({ kind: 'idle' });
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

  async function check(refresh: boolean) {
    status = { kind: 'checking' };
    try {
      const version = await invoke<unknown>('update_check', { refresh });
      if (version === null) {
        status = { kind: 'idle' };
      } else if (typeof version === 'string' && version.length > 0) {
        status = { kind: 'available', version };
      } else {
        throw new Error('Invalid update version');
      }
    } catch {
      status = { kind: 'idle' };
      toast.error('Could not check for updates');
    }
  }

  async function activate() {
    if (busy) {
      return;
    }
    if (status.kind !== 'available') {
      await check(true);
      return;
    }
    const available = status;
    status = { kind: 'installing' };
    try {
      await invoke('update_install', { version: available.version });
    } catch {
      status = available;
      toast.error('Could not install update');
    }
  }

  onMount(() => {
    if (native) {
      void getVersion()
        .then((version) => (currentVersion = version))
        .catch(() => toast.error('Could not read app version'));
      void check(false);
    }
  });
</script>

<Section title="Updates">
  <Row label={`Version ${currentVersion}`}>
    <Button
      size="sm"
      disabled={!native || busy}
      onclick={activate}>{buttonLabel}</Button
    >
  </Row>
</Section>

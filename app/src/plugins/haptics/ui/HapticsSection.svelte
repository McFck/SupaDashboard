<script lang="ts">
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import { configureHaptics } from '../../../platform/haptics';
  import Row from '../../../panel/ui/Row.svelte';
  import Section from '../../../panel/ui/Section.svelte';
  import {
    DEFAULTS,
    loadSettings,
    normalizeSettings,
    saveSettings,
    toConfig,
    type HapticsSettings,
  } from '../settings';

  let settings = $state<HapticsSettings>({ ...DEFAULTS });
  let loaded = $state(false);

  onMount(() => {
    loadSettings()
      .then((saved) => {
        settings = saved;
        loaded = true;
      })
      .catch(() => toast.error('Haptics settings unavailable'));
  });

  async function apply(change: Partial<HapticsSettings>) {
    const next = normalizeSettings({ ...settings, ...change });
    try {
      await saveSettings(next);
      settings = next;
      const connected = await configureHaptics(toConfig(next));
      if (next.enabled && !connected) {
        toast.error('No tablet found');
      }
    } catch (error) {
      console.error(error);
      toast.error('Could not save haptics');
    }
  }
</script>

<Section title="Haptics">
  <Row
    label="Haptics"
    for="haptics-enabled"
    ><Switch
      id="haptics-enabled"
      disabled={!loaded}
      checked={settings.enabled}
      onCheckedChange={(enabled) => apply({ enabled })}
    /></Row
  >
  <Row
    label="Tile press"
    for="haptics-press"
    ><Switch
      id="haptics-press"
      disabled={!loaded}
      checked={settings.pressPulse}
      onCheckedChange={(pressPulse) => apply({ pressPulse })}
    /></Row
  >
  <Row
    label="ADB path"
    for="haptics-adb"
    ><Input
      id="haptics-adb"
      disabled={!loaded}
      value={settings.adbPath}
      autocomplete="off"
      onchange={(event) => apply({ adbPath: event.currentTarget.value })}
    /></Row
  >
  <Row
    label="Device serial"
    for="haptics-serial"
    ><Input
      id="haptics-serial"
      disabled={!loaded}
      value={settings.serial}
      autocomplete="off"
      onchange={(event) => apply({ serial: event.currentTarget.value })}
    /></Row
  >
</Section>

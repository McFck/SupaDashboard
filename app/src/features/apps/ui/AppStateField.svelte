<script lang="ts">
  // Picks an app and one of its live states; the answer is the app's state variable id.
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import Choice from '../../plugins/ui/Choice.svelte';
  import ParamControl from '../../plugins/ui/ParamControl.svelte';
  import type { Param } from '../../plugins/contracts';
  import { APP_STATES, isAppKey, parseAppVariable, type AppField } from '../keys';
  import {
    appKeyForSlug,
    appManual,
    appParam,
    appSlug,
    isOfferedApp,
    refreshApps,
    rememberApp,
  } from '../picker.svelte';

  let { value, onchange }: { value: string; onchange: (variableId: string) => void } = $props();
  const fieldId = $props.id();
  const parsed = $derived(parseAppVariable(value));
  let chosen = $state<AppField | null>(null);
  const field = $derived(chosen ?? parsed?.field ?? 'running');
  let typed = $state<string | null>(null);
  const shown = $derived(typed ?? (parsed ? (appKeyForSlug(parsed.slug) ?? parsed.slug) : ''));

  onMount(() => {
    refreshApps().catch(() => toast.error('Could not refresh options'));
  });

  /** Typing alone changes nothing; a suggestion or a finished entry names the app. */
  function choose(key: string) {
    const slug = isAppKey(key) ? appSlug(key) : undefined;
    if (slug) {
      rememberApp(key);
      typed = null;
      const id = `app.${slug}.${field}`;
      if (id !== value) {
        onchange(id);
      }
    }
  }

  const param: Param = {
    ...appParam,
    manual: { browse: appManual.browse, keep: choose },
  };

  function setField(next: string) {
    chosen = next as AppField;
    if (parsed) {
      onchange(`app.${parsed.slug}.${chosen}`);
    }
  }
</script>

<div class="grid min-w-0 gap-2">
  <ParamControl
    id={fieldId}
    {param}
    value={shown}
    onchange={(next) => {
      typed = String(next);
      if (isOfferedApp(typed)) {
        choose(typed);
      }
    }}
  />
  <Choice
    value={field}
    options={[...APP_STATES]}
    aria-label="App state"
    onchange={setField}
  />
</div>

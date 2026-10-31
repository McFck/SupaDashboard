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
    appName,
    appManual,
    appParam,
    appSlug,
    isOfferedApp,
    refreshApps,
    rememberApp,
  } from '../picker.svelte';

  let {
    value,
    onchange,
    negation,
  }: {
    value: string;
    onchange: (variableId: string) => void;
    /** Conditions: reads "is / is not" before the state, and offers only the on/off states. */
    negation?: { negated: boolean; onchange: (negated: boolean) => void };
  } = $props();
  const fieldId = $props.id();
  const parsed = $derived(parseAppVariable(value));
  let chosen = $state<AppField | null>(null);
  const field = $derived(chosen ?? parsed?.field ?? 'running');
  let typed = $state<string | null>(null);
  const shown = $derived(
    typed ?? (parsed ? appName(appKeyForSlug(parsed.slug) ?? parsed.slug) : ''),
  );

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
  <div class="flex min-w-0 gap-2">
    {#if negation}
      <Choice
        class="w-24 shrink-0"
        value={String(negation.negated)}
        options={[
          { value: 'false', label: 'is' },
          { value: 'true', label: 'is not' },
        ]}
        aria-label="Is or is not"
        onchange={(next) => negation.onchange(next === 'true')}
      />
    {/if}
    <Choice
      class="w-full min-w-0"
      value={field}
      options={negation ? APP_STATES.filter((state) => state.value !== 'display') : [...APP_STATES]}
      aria-label="App state"
      onchange={setField}
    />
  </div>
</div>

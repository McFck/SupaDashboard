<script lang="ts">
  // Picks an app and one of its live states; the answer is the app's state variable id.
  import Choice from '../../plugins/ui/Choice.svelte';
  import MonitorField from './MonitorField.svelte';
  import ParamControl from '../../plugins/ui/ParamControl.svelte';
  import type { Param } from '../../plugins/contracts';
  import {
    APP_STATES,
    appVariable,
    isAppKey,
    parseAppVariable,
    windowState,
    type AppField,
  } from '../keys';
  import { windowsParam, windowParam, titleParam } from '../window-params';
  import { readWindowSelection, type WindowSelection } from '../window-selection';
  import { Label } from '$lib/components/ui/label';
  import {
    appKeyForName,
    appKeyForSlug,
    appOption,
    appManual,
    appParam,
    appSlug,
    isOfferedApp,
    rememberApp,
  } from '../picker.svelte';

  let {
    value,
    onchange,
    negation,
    fixedField,
    monitor,
  }: {
    value: string;
    onchange: (variableId: string) => void;
    /** Conditions: reads "is / is not" before the state. */
    negation?: { negated: boolean; onchange: (negated: boolean) => void };
    /** Bindings: the state was chosen with the variable, so only the app is asked. */
    fixedField?: AppField;
    /** Conditions: the monitor the "On display" state is compared to. */
    monitor?: { value: string; onchange: (name: string) => void };
  } = $props();
  const fieldId = $props.id();
  const parsed = $derived(parseAppVariable(value));
  let chosen = $state<AppField | null>(null);
  const field = $derived(fixedField ?? parsed?.field ?? chosen ?? 'running');
  const selection: WindowSelection = $derived(parsed?.selection ?? { windows: 'main', title: '' });
  const windowArgs = $derived({
    app: parsed ? appKeyForSlug(parsed.slug) : undefined,
    windows: selection.windows,
    title: selection.title,
    window: selection.title,
  });
  let typed = $state<string | null>(null);
  const shown = $derived(typed ?? (parsed ? (appKeyForSlug(parsed.slug) ?? parsed.slug) : ''));

  /** Typing alone changes nothing; a suggestion or a finished entry names the app. */
  function choose(text: string) {
    const key = isAppKey(text) ? text : appKeyForName(text);
    const slug = key ? appSlug(key) : undefined;
    if (key && slug) {
      rememberApp(key);
      typed = null;
      const id = appVariable(slug, field, selection);
      if (id !== value) {
        onchange(id);
      }
    }
  }

  const param: Param = {
    ...appParam,
    describe: (key) =>
      parsed && key === parsed.slug
        ? { ...appOption(appKeyForSlug(key) ?? key), value: key }
        : appParam.describe?.(key),
    manual: { browse: appManual.browse, keep: choose },
  };

  function setField(next: string) {
    chosen = next as AppField;
    if (parsed) {
      onchange(appVariable(parsed.slug, chosen, selection));
    }
  }

  function setSelection(next: WindowSelection) {
    if (parsed) {
      onchange(appVariable(parsed.slug, field, next));
    }
  }

  function setWindows(windows: unknown) {
    const next = readWindowSelection({ windows, title: selection.title });
    if (next) {
      setSelection(next);
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
  {#if !fixedField}
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
        options={negation
          ? APP_STATES.map((state) =>
              state.value === 'display' ? { ...state, label: 'On display' } : state,
            )
          : [...APP_STATES]}
        aria-label="App state"
        onchange={setField}
      />
    </div>
  {/if}
  {#if parsed && windowState(field)}
    <div class="grid gap-1.5">
      <Label
        for={`${fieldId}-windows`}
        class="text-xs text-muted-foreground">Windows</Label
      >
      <ParamControl
        id={`${fieldId}-windows`}
        param={windowsParam}
        value={selection.windows}
        args={windowArgs}
        onchange={setWindows}
      />
    </div>
    {#if selection.windows === 'window' || selection.windows === 'title'}
      {@const windowField = selection.windows === 'window' ? windowParam : titleParam}
      <div class="grid gap-1.5">
        <Label
          for={`${fieldId}-title`}
          class="text-xs text-muted-foreground">{windowField.label}</Label
        >
        <ParamControl
          id={`${fieldId}-title`}
          param={windowField}
          value={selection.title}
          args={windowArgs}
          onchange={(title) => setSelection({ ...selection, title: String(title) })}
        />
      </div>
    {/if}
  {/if}
  {#if monitor && field === 'display'}
    <MonitorField
      value={monitor.value}
      onchange={monitor.onchange}
    />
  {/if}
</div>

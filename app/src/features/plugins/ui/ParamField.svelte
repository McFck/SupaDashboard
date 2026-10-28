<script lang="ts">
  // One argument of an action or value source, rendered from its Param description.
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import { suggestionsOf } from '../registry';
  import type { Option, Param } from '../contracts';
  import Choice from './Choice.svelte';
  import { pluginTitle } from './PluginMark.svelte';
  import SuggestionInput from './SuggestionInput.svelte';

  let {
    param,
    value,
    args,
    provider,
    showPluginMark = true,
    onchange,
  }: {
    param: Param;
    value: unknown;
    args?: Record<string, unknown>;
    provider?: string;
    showPluginMark?: boolean;
    onchange: (v: unknown) => void;
  } = $props();
  const listId = `suggest-${Math.random().toString(36).slice(2)}`;
  const fieldId = `param-${Math.random().toString(36).slice(2)}`;
  let version = $state(0);
  const suggestions = $derived.by(() => {
    void version;
    return suggestionsOf(param, args);
  });
  const refresh = () =>
    param
      .refresh?.(args)
      .then(() => version++)
      .catch(() => {});
  const markedTextSuggestions = $derived(
    (suggestions ?? []).some((option) => pluginTitle(option.plugin ?? provider)),
  );
  const selectOptions = $derived.by((): Option[] => {
    const list = suggestions ?? [],
      current = String(value ?? param.default ?? '');
    const withProvider = list.map((option) => ({ ...option, plugin: option.plugin ?? provider }));
    return current && !list.some((o) => o.value === current)
      ? [...withProvider, { value: current, label: current, plugin: provider }]
      : withProvider;
  });
</script>

<div class="grid gap-1.5">
  <Label
    for={fieldId}
    class="text-xs text-muted-foreground">{param.label}</Label
  >
  {#if param.type === 'select'}
    <Choice
      value={String(value ?? param.default ?? '')}
      options={selectOptions}
      {onchange}
      onopen={refresh}
      {showPluginMark}
    />
  {:else if param.type === 'text' && markedTextSuggestions}
    <SuggestionInput
      value={String(value ?? param.default ?? '')}
      suggestions={suggestions ?? []}
      {provider}
      {onchange}
      onrefresh={refresh}
    />
  {:else if param.type === 'boolean'}
    <Switch
      id={fieldId}
      checked={value === undefined ? param.default === true : value === true}
      onCheckedChange={onchange}
    />
  {:else}
    <Input
      id={fieldId}
      type={param.type === 'number' ? 'number' : 'text'}
      step="any"
      list={suggestions ? listId : undefined}
      value={String(value ?? param.default ?? '')}
      oninput={(e) => {
        const v = e.currentTarget.value;
        onchange(param.type === 'number' ? Number(v) : v);
      }}
    />
    {#if suggestions}
      <datalist id={listId}
        >{#each suggestions as s}<option value={s.value}>{s.label}</option>{/each}</datalist
      >
    {/if}
  {/if}
</div>

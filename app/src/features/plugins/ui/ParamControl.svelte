<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';
  import { suggestionsOf } from '../registry';
  import type { Option, Param } from '../contracts';
  import Choice from './Choice.svelte';
  import { pluginTitle } from './PluginMark.svelte';
  import SuggestionInput from './SuggestionInput.svelte';

  let {
    id: fieldId,
    param,
    value,
    args,
    provider,
    showPluginMark = true,
    onchange,
  }: {
    id: string;
    param: Param;
    value: unknown;
    args?: Record<string, unknown>;
    provider?: string;
    showPluginMark?: boolean;
    onchange: (v: unknown) => void;
  } = $props();
  const listId = `suggest-${Math.random().toString(36).slice(2)}`;
  let slider = $state<HTMLElement | null>(null);
  $effect(() => {
    // The shared slider forwards attributes to its root, but its thumb receives keyboard focus.
    const thumb = slider?.querySelector('[role="slider"]');
    if (thumb) {
      thumb.id = fieldId;
      thumb.setAttribute('aria-label', param.label);
    }
  });
  let version = $state(0);
  const suggestions = $derived.by(() => {
    void version;
    return suggestionsOf(param, args);
  });
  const refresh = () =>
    param
      .refresh?.(args)
      .then(() => version++)
      .catch(() => toast.error('Could not refresh options'));
  const markedTextSuggestions = $derived(
    showPluginMark && (suggestions ?? []).some((option) => pluginTitle(option.plugin ?? provider)),
  );
  const selectOptions = $derived.by((): Option[] => {
    const list = suggestions ?? [],
      current = String(value ?? param.default ?? '');
    const withProvider = list.map((option) => ({ ...option, plugin: option.plugin ?? provider }));
    return current && !list.some((o) => o.value === current)
      ? [...withProvider, { value: current, label: current, plugin: provider }]
      : withProvider;
  });
  // A stored value no suggestion lists (an app that is not running) still reads as a name, never as its raw key.
  const textSuggestions = $derived.by(() => {
    const list = suggestions ?? [];
    const current = String(value ?? param.default ?? '');
    const described = list.some((option) => option.value === current)
      ? undefined
      : param.describe?.(current);
    return described ? [...list, described] : list;
  });
  async function browse() {
    try {
      const picked = await param.manual?.browse();
      if (picked) {
        onchange(picked);
      }
    } catch {
      toast.error('Could not open the file picker');
    }
  }
  function input(event: { currentTarget: HTMLInputElement }) {
    const next = event.currentTarget.value;
    onchange(param.type === 'number' ? Number(next) : next);
  }
</script>

{#if param.type === 'select' && param.searchable}
  <SuggestionInput
    strict
    id={fieldId}
    value={String(value ?? param.default ?? '')}
    suggestions={selectOptions}
    {provider}
    aria-label={param.label}
    {onchange}
    onrefresh={refresh}
  />
{:else if param.type === 'select'}
  <Choice
    value={String(value ?? param.default ?? '')}
    id={fieldId}
    options={selectOptions}
    {onchange}
    onopen={refresh}
    {showPluginMark}
  />
{:else if param.type === 'text' && (markedTextSuggestions || param.manual)}
  <div
    class="flex min-w-0 items-center gap-2"
    onfocusout={() => param.manual?.keep(String(value ?? ''))}
  >
    <SuggestionInput
      value={String(value ?? param.default ?? '')}
      suggestions={textSuggestions}
      {provider}
      {onchange}
      onrefresh={refresh}
    />
    {#if param.manual}
      <Button
        variant="outline"
        onclick={browse}>Browse</Button
      >
    {/if}
  </div>
{:else if param.type === 'number' && param.min !== undefined && param.max !== undefined}
  <div class="flex w-48 items-center gap-3">
    <Slider
      bind:ref={slider}
      type="single"
      min={param.min}
      max={param.max}
      step={param.step ?? 0.01}
      value={Number(value ?? param.default ?? param.min)}
      onValueChange={onchange}
    />
    <span class="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
      >{Number(value ?? param.default ?? param.min)}</span
    >
  </div>
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
    oninput={input}
  />
  {#if suggestions}
    <datalist id={listId}
      >{#each suggestions as s}<option value={s.value}>{s.label}</option>{/each}</datalist
    >
  {/if}
{/if}

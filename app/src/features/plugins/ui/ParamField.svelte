<script lang="ts">
  // One argument of an action or value source, rendered from its Param description.
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import { suggestionsOf } from '../registry';
  import type { ActionRef, Option, Param } from '../contracts';
  import ActionEditor from '../../automation/editor/ActionEditor.svelte';
  import Choice from './Choice.svelte';
  import PluginMark, { pluginTitle } from './PluginMark.svelte';
  import SuggestionInput from './SuggestionInput.svelte';

  let { param, value, args, provider, showPluginMark = true, onchange }: { param: Param; value: unknown; args?: Record<string, unknown>;
    provider?: string; showPluginMark?: boolean; onchange: (v: unknown) => void } = $props();
  const listId = `suggest-${Math.random().toString(36).slice(2)}`;
  const fieldId = `param-${Math.random().toString(36).slice(2)}`;
  let version = $state(0);
  const suggestions = $derived.by(() => { void version; return suggestionsOf(param, args); });
  const refresh = () => param.refresh?.(args).then(() => version++).catch(() => {});
  const markedTextSuggestions = $derived((suggestions ?? []).some(option => pluginTitle(option.plugin ?? provider)));
  const selectOptions = $derived.by((): Option[] => {
    const list = suggestions ?? [], current = String(value ?? param.default ?? '');
    const withProvider = list.map(option => ({ ...option, plugin: option.plugin ?? provider }));
    return current && !list.some(o => o.value === current) ? [...withProvider, { value: current, label: current, plugin: provider }] : withProvider;
  });
  const steps = $derived((value as ActionRef[] | undefined) ?? []);
  const setStep = (i: number, s: ActionRef | null) =>
    onchange(s ? steps.map((x, j) => (j === i ? s : x)) : steps.filter((_, j) => j !== i));
  const swap = (i: number, j: number) => {
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onchange(next);
  };
</script>

<div class="grid gap-1.5">
  <Label for={fieldId} class="text-xs text-muted-foreground">{param.label}</Label>
  {#if param.type === 'actions'}
    <div class="grid gap-2 border-l-2 border-white/10 pl-3">
      {#each steps as step, i (i)}
        <div class="grid gap-2 rounded-lg bg-white/[.03] p-2">
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>Step {i + 1}</span>
            <span class="flex gap-1">
              <Button size="icon-sm" variant="ghost" disabled={i === 0} onclick={() => swap(i, i - 1)} aria-label="Move up"><ArrowUp /></Button>
              <Button size="icon-sm" variant="ghost" disabled={i === steps.length - 1} onclick={() => swap(i, i + 1)} aria-label="Move down"><ArrowDown /></Button>
              <Button size="icon-sm" variant="ghost" onclick={() => setStep(i, null)} aria-label="Remove step"><Trash /></Button>
            </span>
          </div>
          <ActionEditor value={step} onchange={s => setStep(i, s)} />
        </div>
      {/each}
      <Button variant="outline" size="sm" onclick={() => onchange([...steps, { id: 'media.toggle' }])}><Plus /> Add step</Button>
    </div>
  {:else if param.type === 'select'}
    <Choice value={String(value ?? param.default ?? '')} options={selectOptions} onchange={onchange} onopen={refresh} {showPluginMark} />
  {:else if param.type === 'text' && markedTextSuggestions}
    <SuggestionInput value={String(value ?? param.default ?? '')} suggestions={suggestions ?? []} {provider}
      onchange={onchange} onrefresh={refresh} />
  {:else if param.type === 'boolean'}
    <Switch id={fieldId} checked={value === undefined ? param.default === true : value === true} onCheckedChange={onchange} />
  {:else}
    <Input id={fieldId} type={param.type === 'number' ? 'number' : 'text'} step="any" list={suggestions ? listId : undefined}
      value={String(value ?? param.default ?? '')}
      oninput={e => { const v = e.currentTarget.value; onchange(param.type === 'number' ? Number(v) : v); }} />
    {#if suggestions}
      <datalist id={listId}>{#each suggestions as s}<option value={s.value}>{s.label}</option>{/each}</datalist>

    {/if}
  {/if}
</div>

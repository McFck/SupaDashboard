<script lang="ts">
  // Pick what a slider controls (system volume, an app's volume, or a plugin's value) and its arguments.
  import { values, type ValueRef } from '../core/registry';
  import Choice from './Choice.svelte';
  import ParamField from './ParamField.svelte';

  let { value, onchange }: { value: ValueRef; onchange: (v: ValueRef) => void } = $props();
  const def = $derived(values.get(value.id));
  const options = [...values.values()].map(v => ({ value: v.id, label: v.title, plugin: v.plugin }));
  const pick = (id: string) => onchange({ id, args: Object.fromEntries(
    (values.get(id)?.params ?? []).filter(p => p.default !== undefined).map(p => [p.key, p.default])) });
</script>

<div class="grid gap-3">
  <Choice value={value.id} {options} onchange={pick} placeholder="Choose what it controls" />
  {#each def?.params ?? [] as param (param.key)}
    <ParamField {param} provider={def?.plugin} value={value.args?.[param.key]}
      onchange={v => onchange({ ...value, args: { ...value.args, [param.key]: v } })} />
  {/each}
</div>

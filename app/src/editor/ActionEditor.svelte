<script lang="ts">
  // Pick any registered action (built-in or plugin) and fill in its arguments.
  import { actions, type ActionRef } from '../core/registry';
  import ActionPicker from './ActionPicker.svelte';
  import ParamField from './ParamField.svelte';

  let { value, onchange }: { value: ActionRef; onchange: (v: ActionRef) => void } = $props();
  const def = $derived(actions.get(value.id));

  function pick(id: string) {
    const params = actions.get(id)?.params ?? [];
    onchange({ id, args: Object.fromEntries(params.filter(p => p.default !== undefined).map(p => [p.key, structuredClone(p.default)])) });
  }
</script>

<div class="grid gap-3">
  <ActionPicker value={value.id} onpick={pick} />
  {#each def?.params ?? [] as param (param.key)}
    <ParamField {param} provider={def?.plugin} value={value.args?.[param.key]}
      onchange={v => onchange({ ...value, args: { ...value.args, [param.key]: v } })} />
  {/each}
</div>

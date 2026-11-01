<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import { Button } from '$lib/components/ui/button';
  import type { Variant } from '../model';
  import type { StateBinding } from '../../automation/scenario';
  import BindingCard from './BindingCard.svelte';

  let {
    bindings,
    variants,
    roles,
    onchange,
  }: {
    /** Top to bottom: the first binding with a mapping for its variable's value decides the state. */
    bindings: StateBinding[];
    variants: Variant[];
    roles?: { off: string; on: string };
    onchange: (value: StateBinding[]) => void;
  } = $props();

  function move(from: number, direction: -1 | 1) {
    const next = [...bindings];
    [next[from], next[from + direction]] = [next[from + direction], next[from]];
    onchange(next);
  }
</script>

<div class="grid min-h-0 gap-4 overflow-y-auto p-4 [scrollbar-gutter:stable]">
  {#each bindings as binding, index (index)}
    <BindingCard
      {binding}
      {variants}
      {roles}
      sole={bindings.length === 1}
      first={index === 0}
      last={index === bindings.length - 1}
      onchange={(next) => onchange(bindings.map((item, i) => (i === index ? next : item)))}
      onmove={(direction) => move(index, direction)}
      onremove={() => onchange(bindings.filter((_, i) => i !== index))}
    />
  {/each}
  <Button
    variant="outline"
    onclick={() => onchange([...bindings, { variableId: '', cases: [] }])}
    ><Plus /> Add binding</Button
  >
</div>

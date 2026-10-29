<script lang="ts">
  import { Label } from '$lib/components/ui/label';
  import type { ComponentProps } from 'svelte';
  import ParamControl from './ParamControl.svelte';

  let props: Omit<ComponentProps<typeof ParamControl>, 'id'> = $props();
  // Action and value editors retain their unbounded inputs until they opt into settings bounds.
  const id = `param-${Math.random().toString(36).slice(2)}`;
</script>

<div class="grid gap-1.5">
  <Label
    for={id}
    class="text-xs text-muted-foreground">{props.param.label}</Label
  >
  <ParamControl
    {id}
    {...props}
    param={{ ...props.param, min: undefined, max: undefined }}
  />
</div>

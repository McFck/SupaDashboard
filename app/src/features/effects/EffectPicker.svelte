<script lang="ts">
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { Popover } from 'bits-ui';
  import { Button } from '$lib/components/ui/button';
  import Hint from '$lib/components/ui/tooltip/hint.svelte';
  import { EFFECTS, type EffectId } from './catalogue';
  let {
    value,
    label,
    conflict,
    onchange,
  }: {
    value?: EffectId;
    label: string;
    conflict?: string;
    onchange: (value: EffectId | undefined) => void;
  } = $props();
  let open = $state(false);
  let pending = $state<EffectId>();
  const gestureOwns = $derived(conflict === 'Replace gesture effect');
  function choose(effect?: EffectId) {
    if (effect && conflict && !gestureOwns) {
      pending = effect;
      return;
    }
    onchange(effect);
    open = false;
  }
  function replace() {
    onchange(pending);
    pending = undefined;
    open = false;
  }
</script>

<Popover.Root
  bind:open
  onOpenChange={() => {
    pending = undefined;
  }}
>
  {#if gestureOwns}
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      disabled
      class="effect-button shrink-0 text-muted-foreground"><Sparkles /></Button
    >
  {/if}
  <Popover.Trigger>
    {#snippet child({ props })}
      <Hint text={gestureOwns ? undefined : label}>
        {#snippet children(hint)}
          <Button
            {...hint}
            {...props}
            variant="ghost"
            size={gestureOwns ? 'sm' : 'icon-sm'}
            aria-label={gestureOwns ? 'Replace gesture effect' : label}
            class="effect-button shrink-0 {value ? 'text-primary' : 'text-muted-foreground'}"
            data-active={!!value}
          >
            {#if gestureOwns}Replace gesture effect{:else}<Sparkles
                fill={value ? 'currentColor' : 'none'}
              />{/if}
          </Button>
        {/snippet}
      </Hint>
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      sideOffset={5}
      class="z-[100] w-64 rounded-xl bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-border"
      aria-label="Tile effect"
    >
      {#if pending}
        <Button
          size="sm"
          variant="secondary"
          class="w-full"
          onclick={replace}>{conflict}</Button
        >
      {:else}
        <div class="grid grid-cols-3 gap-1">
          <Button
            size="sm"
            aria-label="None"
            variant={!value ? 'secondary' : 'ghost'}
            onclick={() => choose()}>None</Button
          >
          {#each EFFECTS as effect (effect.id)}
            <Button
              size="sm"
              aria-label={effect.label}
              variant={value === effect.id ? 'secondary' : 'ghost'}
              class="h-14 flex-col gap-1 text-xs"
              onclick={() => choose(effect.id)}
            >
              <span
                aria-hidden="true"
                class="text-lg">{effect.icon}</span
              >{effect.label}
            </Button>
          {/each}
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  @media (hover: hover) {
    :global(
      .effect-hover:not(:hover):not(:focus-within)
        .effect-button:not([data-active='true']):not([data-state='open'])
    ) {
      opacity: 0;
    }
  }
</style>

<script lang="ts">
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { mergeProps, Popover } from 'bits-ui';
  import { Button } from '$lib/components/ui/button';
  import Hint from '$lib/components/ui/tooltip/hint.svelte';
  import { EFFECTS, type EffectId } from './catalogue';
  import EffectIcon from './EffectIcon.svelte';
  import EffectMark from './EffectMark.svelte';
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
            {...mergeProps(hint, props)}
            variant="ghost"
            size={gestureOwns ? 'sm' : 'icon-sm'}
            aria-label={gestureOwns ? 'Replace gesture effect' : label}
            class="effect-button shrink-0 text-muted-foreground"
            data-active={!!value}
          >
            {#if gestureOwns}Replace gesture effect{:else if value}<EffectMark />{:else}<Sparkles
              />{/if}
          </Button>
        {/snippet}
      </Hint>
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      sideOffset={5}
      class="z-[100] w-[22.5rem] rounded-xl bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-border"
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
        <Button
          size="sm"
          aria-label="None"
          variant={!value ? 'secondary' : 'ghost'}
          class="mb-1 w-full"
          onclick={() => choose()}>None</Button
        >
        <div class="grid grid-cols-5 gap-1">
          {#each EFFECTS as effect (effect.id)}
            <Button
              size="sm"
              aria-label={effect.label}
              aria-pressed={value === effect.id}
              variant="ghost"
              class="h-16 min-w-0 flex-col gap-1.5 px-0.5 text-[11px] aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-primary/70"
              onclick={() => choose(effect.id)}
            >
              <EffectIcon
                effect={effect.id}
                class="size-7"
              /><span class="w-full truncate">{effect.label}</span>
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

<script lang="ts">
  // A control's states (variants) as sortable cards; edits go straight to the live control.
  import { prefersReducedMotion as reducedMotion } from 'svelte/motion';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { sortable } from '$lib/sortable';
  import { SPRING_SAMPLES, springDuration } from '$lib/spring';
  import ColorField from '$lib/components/ColorField.svelte';
  import { MAX_VARIANTS, type ControlConfig, type Variant } from '../../controls/model';
  import { moveVariant, removeVariant as removeStateVariant } from '../../controls/variants';
  import { newStateFrom } from '../../automation/editor/scenario-edit';
  import IconPicker from '../../controls/editor/IconPicker.svelte';
  import ValueEditor from '../../controls/editor/ValueEditor.svelte';
  import { settings } from '../../settings/state.svelte';
  import { commit } from '../history.svelte';

  let { control }: { control: ControlConfig } = $props();

  let list = $state<HTMLElement>();
  /** A pointer drag already moved the card into place, so its list reorder must not animate again. */
  let skipFlip = false;

  const variantId = (variant: Variant, index: number) => variant.id ?? `state-${index + 1}`;

  function addVariant() {
    if (control.variants.length < MAX_VARIANTS) {
      control.variants.push(newStateFrom($state.snapshot(control.variants.at(-1)!) as Variant));
    }
  }

  function reorder(from: number, to: number, label = 'Reorder variants') {
    commit(label);
    settings.variants[control.id] = moveVariant(
      control,
      settings.variants[control.id] ?? 0,
      from,
      to,
    );
  }

  function dragged(from: number, to: number) {
    skipFlip = true;
    reorder(from, to);
    setTimeout(() => {
      skipFlip = false;
    }, 50);
  }

  function remove(index: number) {
    if (control.variants.length < 2) {
      return;
    }
    settings.variants[control.id] = removeStateVariant(
      control,
      settings.variants[control.id] ?? 0,
      index,
    );
  }

  function handleKeydown(event: KeyboardEvent, index: number) {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : -1;
    if (to < 0 || to >= control.variants.length) {
      return;
    }
    event.preventDefault();
    reorder(index, to);
  }

  function springProgressAt(time: number) {
    const position = Math.max(0, Math.min(1, time)) * (SPRING_SAMPLES.length - 1);
    const index = Math.min(SPRING_SAMPLES.length - 2, Math.floor(position));
    const fraction = position - index;
    const from = SPRING_SAMPLES[index].progress;
    const to = SPRING_SAMPLES[index + 1].progress;
    return from + (to - from) * fraction;
  }

  function flip(_node: Element, { from, to }: { from: DOMRect; to: DOMRect }) {
    const offset = from.top - to.top;
    const instant = reducedMotion.current || skipFlip || !offset;
    return {
      duration: instant ? 0 : springDuration(Math.abs(offset)),
      css: (time: number) => `transform: translateY(${offset * (1 - springProgressAt(time))}px)`,
    };
  }
</script>

<section class="grid gap-3">
  <div class="flex items-center justify-between">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variants</h3>
    <Button
      variant="ghost"
      size="sm"
      disabled={control.variants.length >= MAX_VARIANTS}
      onclick={addVariant}
    >
      <Plus /> Add
    </Button>
  </div>
  <div
    bind:this={list}
    use:sortable={{
      axis: 'y',
      items: () => [...(list?.querySelectorAll<HTMLElement>('[data-variant-card]') ?? [])],
      handle: '[data-sort-handle]',
      onmove: dragged,
    }}
    class="relative grid gap-3"
  >
    {#each control.variants as variant, index (variantId(variant, index))}
      <div
        data-variant-card
        data-variant-id={variantId(variant, index)}
        animate:flip
        class="relative grid min-w-0 gap-3 rounded-xl border bg-card p-3 transition-[transform,box-shadow] duration-200 ease-out"
      >
        <div class="flex items-end gap-2">
          {#if control.variants.length > 1}
            <button
              type="button"
              data-sort-handle
              aria-label="Reorder variant"
              class="mb-2 grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing"
              onkeydown={(event) => handleKeydown(event, index)}
            >
              <GripVertical class="size-4" />
            </button>
          {/if}
          <IconPicker
            value={variant.icon ?? undefined}
            onchange={(name) => (variant.icon = name)}
          />
          <div class="grid min-w-0 flex-1 gap-1">
            <Label class="text-[11px] text-muted-foreground">Label</Label>
            <Input bind:value={variant.label} />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove variant"
            disabled={control.variants.length === 1}
            onclick={() => remove(index)}
          >
            <Trash />
          </Button>
        </div>
        <div class="grid gap-2">
          <Label class="text-xs text-muted-foreground">Colour</Label>
          <ColorField
            value={variant.color ?? '#8ea8f0'}
            onchange={(color) => (variant.color = color)}
          />
        </div>
        {#if control.type === 'slider'}
          <ValueEditor
            value={variant.value ?? { id: 'volume' }}
            onchange={(value) => (variant.value = value)}
          />
        {/if}
      </div>
    {/each}
  </div>
</section>

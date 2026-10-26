<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { MAX_VARIANTS, type TileAppearance, type Variant } from '../model';
  import { renderTemplate } from '../../automation/templates';
  import { runtimeView } from '../../../app/runtime/state';
  import ButtonFace from '../ui/ButtonFace.svelte';
  import StateView from '../ui/StateView.svelte';
  import ColorField from '$lib/components/ColorField.svelte';
  import IconPicker from './IconPicker.svelte';
  import Choice from '../../plugins/ui/Choice.svelte';

  const id = $props.id();
  let {
    variants,
    roles,
    aspectRatio = 1,
    onvariant,
    onroles,
    ontoggleroles,
    onadd,
    onremove,
    onmove,
  }: {
    variants: Variant[];
    roles?: { off: string; on: string };
    aspectRatio?: number;
    onvariant: (index: number, variant: Variant) => void;
    onroles: (roles: { off: string; on: string } | undefined) => void;
    ontoggleroles: () => void;
    onadd: () => void;
    onremove: (index: number) => void;
    onmove: (from: number, to: number) => void;
  } = $props();
  const states = $derived(
    variants.map((variant, index) => ({
      value: variant.id ?? `state-${index + 1}`,
      label: variant.label || `State ${index + 1}`,
    })),
  );
  let selectedId = $state('');
  let previewId = $state('');
  const selectedIndex = $derived(
    Math.max(
      0,
      variants.findIndex((variant, index) => (variant.id ?? `state-${index + 1}`) === selectedId),
    ),
  );
  const selected = $derived(variants[selectedIndex]);
  const preview = $derived(
    variants.find(
      (variant, index) => (variant.id ?? `state-${index + 1}`) === (previewId || selectedId),
    ) ?? selected,
  );
  const previewKey = $derived(preview?.id ?? `state-${Math.max(0, variants.indexOf(preview)) + 1}`);
  function resolveView(variant: Variant | undefined): TileAppearance {
    const label = renderTemplate(variant?.label ?? '', (name) => {
      const key = name.trim().toLocaleLowerCase();
      const record = Object.values($runtimeView.variables.records).find((item) =>
        [item.definition.name, ...(item.definition.aliases ?? [])].some(
          (alias) => alias.trim().toLocaleLowerCase() === key,
        ),
      );
      return record?.value;
    });
    return {
      label: label.text,
      icon: variant?.icon,
      color: variant?.color,
      background: variant?.background,
    };
  }
  const previewView = $derived(resolveView(preview));
  const roleOptions = (excluded: string, current: string) => [
    ...states.filter((state) => state.value !== excluded),
    ...(current && !states.some((state) => state.value === current)
      ? [{ value: current, label: `Unavailable · ${current}` }]
      : []),
  ];

  $effect(() => {
    const ids = states.map((state) => state.value);
    if (!ids.includes(selectedId)) selectedId = ids[0] ?? '';
    if (!ids.includes(previewId))
      previewId = roles?.off && ids.includes(roles.off) ? roles.off : (ids[0] ?? '');
  });

  function update(patch: Partial<Variant>) {
    if (selected) onvariant(selectedIndex, { ...selected, ...patch });
  }
  function stateView(index: number): TileAppearance {
    return resolveView(variants[index]);
  }
</script>

<div class="grid min-h-0 content-start gap-4 overflow-y-auto p-4 [scrollbar-gutter:stable]">
  {#if roles}
    <div class="grid grid-cols-2 gap-3">
      {#each [{ id: roles.off, label: 'Off' }, { id: roles.on, label: 'On' }] as role (role.label)}
        {@const index = variants.findIndex(
          (variant, i) => (variant.id ?? `state-${i + 1}`) === role.id,
        )}
        {#if index >= 0}
          {@const appearance = stateView(index)}
          <button
            type="button"
            class="grid min-w-0 gap-1 rounded-lg border bg-card p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label={`Preview ${role.label} state`}
            onclick={() => {
              selectedId = role.id;
              previewId = role.id;
            }}
          >
            <span class="text-xs font-medium text-muted-foreground">{role.label}</span>
            <div
              class="tile relative w-full overflow-hidden"
              style:aspect-ratio={aspectRatio}
              style:--accent={appearance.color ?? '#8ea8f0'}
            >
              <ButtonFace
                {appearance}
                presentation={{ key: 'state-editor', view: appearance }}
                stateId="preview"
                stateIndex={0}
                busy={false}
                pull={null}
                compact={false}
                pixelWidth={88}
                pixelHeight={88}
              />
            </div>
          </button>
        {/if}
      {/each}
    </div>
  {/if}

  <section
    class="grid min-w-0 gap-3 rounded-xl border bg-card p-3"
    aria-label="State preview"
  >
    <div class="flex flex-wrap items-center gap-2">
      <Label class="min-w-0 flex-1 text-xs text-muted-foreground">Preview</Label>
      {#if roles}
        <Button
          size="sm"
          variant={previewId === roles.off ? 'secondary' : 'ghost'}
          onclick={() => (previewId = roles.off)}>Off</Button
        >
        <Button
          size="sm"
          variant={previewId === roles.on ? 'secondary' : 'ghost'}
          onclick={() => (previewId = roles.on)}>On</Button
        >
      {:else}
        <div class="w-40">
          <Choice
            value={previewId || selectedId}
            options={states}
            aria-label="Preview state"
            onchange={(value) => (previewId = value)}
          />
        </div>
      {/if}
    </div>
    <div
      class="tile relative mx-auto w-full max-w-60 overflow-hidden border"
      style:aspect-ratio={aspectRatio}
      style:--accent={previewView.color ?? '#8ea8f0'}
    >
      <StateView presentation={{ key: `scenario-preview:${previewKey}`, view: previewView }}>
        {#snippet children(view)}<ButtonFace
            appearance={view}
            presentation={{ key: 'state-editor', view }}
            stateId="preview"
            stateIndex={0}
            busy={false}
            pull={null}
            compact={false}
            pixelWidth={100}
            pixelHeight={100}
          />{/snippet}
      </StateView>
    </div>
  </section>

  <div class="grid gap-3 rounded-xl border p-3">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="min-w-0 flex-1 text-sm font-semibold">States</h3>
      <Button
        size="sm"
        variant="outline"
        disabled={variants.length >= MAX_VARIANTS}
        onclick={onadd}><Plus /> Add state</Button
      >
      {#if !roles}
        <Button
          size="sm"
          variant="outline"
          disabled={variants.length < 1}
          onclick={ontoggleroles}>Enable Off/On</Button
        >
      {:else}
        <Button
          size="sm"
          variant="ghost"
          onclick={ontoggleroles}>Remove Off/On</Button
        >
      {/if}
    </div>
    {#if roles}
      <div class="grid gap-2 sm:grid-cols-2">
        <div class="grid gap-1">
          <Label class="text-xs text-muted-foreground">Off state</Label>
          <Choice
            value={roles.off}
            options={roleOptions(roles.on, roles.off)}
            aria-label="Off state"
            onchange={(value) => onroles({ ...roles, off: value })}
          />
        </div>
        <div class="grid gap-1">
          <Label class="text-xs text-muted-foreground">On state</Label>
          <Choice
            value={roles.on}
            options={roleOptions(roles.off, roles.on)}
            aria-label="On state"
            onchange={(value) => onroles({ ...roles, on: value })}
          />
        </div>
      </div>
    {/if}
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <div class="min-w-48 flex-1">
        <Choice
          value={selectedId}
          options={states}
          aria-label="Selected state"
          onchange={(value) => (selectedId = value)}
        />
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Move state up"
        disabled={selectedIndex === 0}
        onclick={() => onmove(selectedIndex, selectedIndex - 1)}><ArrowUp /></Button
      >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Move state down"
        disabled={selectedIndex >= variants.length - 1}
        onclick={() => onmove(selectedIndex, selectedIndex + 1)}><ArrowDown /></Button
      >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Remove state"
        disabled={variants.length < 2}
        onclick={() => onremove(selectedIndex)}><Trash /></Button
      >
    </div>
  </div>

  {#if selected}
    <div class="grid gap-4 rounded-xl border p-3">
      <div class="grid gap-1.5">
        <Label
          for={`${id}-state-label`}
          class="text-xs leading-4 font-medium text-muted-foreground">Label</Label
        >
        <Input
          id={`${id}-state-label`}
          value={selected.label}
          oninput={(event) => update({ label: event.currentTarget.value })}
        />
      </div>
      <div class="grid gap-1.5">
        <Label class="text-xs leading-4 font-medium text-muted-foreground">Icon</Label>
        <div class="flex min-w-0 items-center gap-2">
          <IconPicker
            size="sm"
            value={selected.icon ?? undefined}
            onchange={(icon) => update({ icon })}
          />
          <Button
            size="default"
            variant="ghost"
            onclick={() => update({ icon: null })}>Clear icon</Button
          >
        </div>
      </div>
      <div class="grid gap-1.5">
        <div class="flex min-w-0 items-center justify-between gap-2">
          <Label class="text-xs leading-4 font-medium text-muted-foreground"
            >Text and icon colour</Label
          >
          {#if selected.color != null}<Button
              size="sm"
              variant="ghost"
              class="shrink-0"
              onclick={() => update({ color: null })}>Inherit colour</Button
            >{/if}
        </div>
        {#if selected.color == null}<Button
            size="sm"
            variant="outline"
            class="justify-self-start"
            onclick={() => update({ color: '#ffffff' })}>Set colour</Button
          >
        {:else}<ColorField
            value={selected.color}
            onchange={(color) => update({ color })}
          />{/if}
      </div>
      <div class="grid gap-1.5">
        <Label class="text-xs leading-4 font-medium text-muted-foreground">Background</Label>
        <div class="grid gap-2">
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={selected.background === undefined ? 'secondary' : 'outline'}
              onclick={() => update({ background: undefined })}>Inherit</Button
            >
            <Button
              size="sm"
              variant={selected.background === null ? 'secondary' : 'outline'}
              onclick={() => update({ background: null })}>Transparent</Button
            >
          </div>
          <ColorField
            value={selected.background ?? '#171717'}
            onchange={(background) => update({ background })}
          />
        </div>
      </div>
    </div>
  {/if}
</div>

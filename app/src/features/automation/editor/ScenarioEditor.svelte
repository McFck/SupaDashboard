<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import type { Trigger } from '../scenario';
  import { availableGestures } from '../../controls/model';
  import { settings } from '../../settings/state.svelte';
  import { placementById } from '../../layout/skin-layouts';
  import Choice from '../../plugins/ui/Choice.svelte';
  import StateViewEditor from '../../controls/editor/StateViewEditor.svelte';
  import StateBindingEditor from '../../controls/editor/StateBindingEditor.svelte';
  import VariablesEditor from './VariablesEditor.svelte';
  import { ScenarioDraftEditor, type ScenarioEditorTab } from './scenario-draft.svelte';
  import ScenarioTabs from './ScenarioTabs.svelte';
  import ScenarioTriggerNav from './ScenarioTriggerNav.svelte';
  import ScenarioStepsPanel from './ScenarioStepsPanel.svelte';
  import ScenarioStatesAside from './ScenarioStatesAside.svelte';

  const PULLS: readonly Trigger[] = ['swipeUp', 'swipeDown', 'swipeLeft', 'swipeRight'];
  const PANELS: readonly ScenarioEditorTab[] = ['scenario', 'views', 'binding', 'variables'];

  let {
    open = $bindable(false),
    controlId = '',
    itemId = '',
    initialTrigger = 'press',
  }: {
    open?: boolean;
    controlId?: string;
    itemId?: string;
    initialTrigger?: Trigger;
  } = $props();

  const editorId = $props.id();
  const editor = new ScenarioDraftEditor(() => controlId);
  const control = $derived(editor.control);
  const placement = $derived(placementById(settings, itemId));

  // A slider's own value axis cannot also be a pull: those triggers stay visible but disabled.
  const blockedTriggers = $derived.by(() => {
    const item = placement?.item;
    if (control?.type !== 'slider' || !placement || !item) {
      return new Set<Trigger>();
    }
    const allowed: readonly string[] = availableGestures(
      control.type,
      placement.width ?? item.w,
      placement.height ?? item.h,
      placement.slot?.kind === 'strip',
    );
    return new Set(PULLS.filter((trigger) => !allowed.includes(trigger)));
  });
  const previewAspect = $derived(
    placement?.item && placement.width && placement.height ? placement.width / placement.height : 1,
  );

  let openedControl = '';
  let opener = $state<HTMLElement | null>(null);
  /** The control was deleted while open: closing must not move focus back into a removed tile. */
  let closedByDeletion = false;

  $effect(() => {
    if (!open) {
      openedControl = '';
      return;
    }
    if (!control) {
      closedByDeletion = true;
      open = false;
      return;
    }
    if (openedControl === controlId) {
      return;
    }
    openedControl = controlId;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    editor.open(initialTrigger);
  });

  onDestroy(() => {
    if (opener?.isConnected && !closedByDeletion) {
      opener.focus();
    }
  });

  function closeAutoFocus(event: Event) {
    if (opener?.isConnected) {
      event.preventDefault();
      opener.focus();
    }
  }

  /** Ctrl+Z belongs to the inputs inside the dialog, not to the panel's undo history. */
  function keydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.stopPropagation();
    }
  }

  function reload() {
    if (!editor.reload()) {
      open = false;
    }
  }

  function save() {
    if (editor.save()) {
      open = false;
    }
  }

  const panelClass = (tab: ScenarioEditorTab) =>
    `min-h-0 min-w-0 flex-1 flex-col ${editor.selectedTab === tab ? 'flex' : 'hidden'}`;
</script>

{#snippet tabPanel(tab: ScenarioEditorTab)}
  <div
    id={`${editorId}-${tab}-panel`}
    role="tabpanel"
    aria-labelledby={`${editorId}-${tab}-tab`}
    class={panelClass(tab)}
  >
    {@render panelContent(tab)}
  </div>
{/snippet}

{#snippet panelContent(tab: ScenarioEditorTab)}
  {@const draft = editor.draft!}
  {#if tab === 'scenario'}
    <ScenarioStepsPanel {editor} />
  {:else if tab === 'views'}
    <StateViewEditor
      variants={draft.variants}
      roles={draft.stateRoles}
      aspectRatio={previewAspect}
      onvariant={(index, variant) => editor.replaceVariant(index, variant)}
      onroles={(roles) => editor.updateRoles(roles)}
      ontoggleroles={() => editor.toggleRoles()}
      onadd={() => editor.addState()}
      onremove={(index) => editor.deleteState(index)}
      onmove={(from, to) => editor.moveState(from, to)}
    />
  {:else if tab === 'binding'}
    <StateBindingEditor
      binding={draft.stateBinding}
      variants={draft.variants}
      roles={draft.stateRoles}
      onchange={(binding) => editor.updateBinding(binding)}
    />
  {:else}
    <VariablesEditor />
  {/if}
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content
    aria-describedby={undefined}
    onkeydown={keydown}
    onCloseAutoFocus={closeAutoFocus}
    class="flex h-[min(760px,calc(100dvh-48px))] w-[min(1100px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 data-closed:scale-100 transition-opacity motion-reduce:transition-none"
  >
    <Dialog.Header class="grid h-28 shrink-0 grid-rows-[48px_64px] gap-0 border-b px-5">
      <div class="flex min-w-0 items-center gap-3 pr-9">
        <Dialog.Title class="shrink-0 text-left">Scenario</Dialog.Title>
        <span class="min-w-0 truncate border-l pl-3 text-sm text-muted-foreground">
          {control?.name ?? 'Unavailable'}
        </span>
      </div>
      {#if editor.draft && control}
        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_160px] items-center gap-4">
          <ScenarioTabs
            {editor}
            idPrefix={editorId}
          />
          <fieldset
            class="w-40 min-w-0 disabled:opacity-50"
            disabled={editor.selectedTab !== 'scenario' ||
              !editor.owner ||
              editor.draft.variants.length < 2}
          >
            <Choice
              value={editor.selectedState}
              options={editor.stateOptions}
              aria-label="State scenario"
              onchange={(value) => editor.selectState(value)}
            />
          </fieldset>
        </div>
      {/if}
    </Dialog.Header>

    {#if editor.draft && control}
      <div
        class="grid min-h-0 min-w-0 flex-1 {editor.contentControl
          ? 'grid-cols-[176px_minmax(0,1fr)]'
          : 'grid-cols-[176px_minmax(0,1fr)_240px]'} max-[900px]:grid-cols-[144px_minmax(0,1fr)]"
      >
        <ScenarioTriggerNav
          {editor}
          {blockedTriggers}
        />
        <main class="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {#each PANELS as tab (tab)}
            {@render tabPanel(tab)}
          {/each}
        </main>
        {#if !editor.contentControl}
          <ScenarioStatesAside {editor} />
        {/if}
      </div>
    {/if}

    <Dialog.Footer
      class="mx-0 mb-0 flex min-h-14 shrink-0 items-center justify-between gap-3 border-t px-6 py-3"
    >
      <div
        class="min-w-0 flex-1"
        aria-live="polite"
      >
        {#if editor.conflict}
          <div class="flex items-center gap-2 text-sm text-destructive">
            <span>Changed elsewhere</span>
            <Button
              variant="outline"
              size="sm"
              onclick={reload}
            >
              Reload
            </Button>
          </div>
        {:else if editor.newIssues.length}
          <span class="text-sm text-destructive">{editor.newIssues[0].message}</span>
        {:else if editor.isOverLimit}
          <span class="text-sm text-destructive">Scenario exceeds 1000 steps</span>
        {/if}
      </div>
      <div class="flex shrink-0 gap-2">
        <Dialog.Close>
          <Button
            variant="ghost"
            size="sm"
          >
            Cancel
          </Button>
        </Dialog.Close>
        <Button
          size="sm"
          disabled={!editor.canSave}
          onclick={save}
        >
          Save
        </Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

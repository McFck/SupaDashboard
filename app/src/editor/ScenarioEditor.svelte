<script lang="ts">
  import { onDestroy } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import * as Dialog from '$lib/components/ui/dialog';
  import type { EventList, Trigger } from '../core/scenario';
  import { newScenarioId, TRIGGERS, validateScenario } from '../core/scenario';
  import { availableGestures, moveVariant, removeVariant, type ControlConfig, type Variant } from '../core/controls';
  import { stateIdAt, validateStateConfiguration } from '../core/button-state';
  import { runtimeView } from '../core/runtime.svelte';
  import { registeredEvents } from '../core/registry';
  import { controlById, settings } from '../core/settings.svelte';
  import { placementById } from '../core/pages';
  import { commit } from '../core/history.svelte';
  import Choice from './Choice.svelte';
  import PluginMark, { pluginTitle } from './PluginMark.svelte';
  import ScenarioSteps from './ScenarioSteps.svelte';
  import StateViewEditor from './StateViewEditor.svelte';
  import StateBindingEditor from './StateBindingEditor.svelte';
  import VariablesEditor from './VariablesEditor.svelte';
  import { createScenarioDraft, sameScenarioDraft, scenarioNodeCount, scenarioStepCount,
    cloneDraftValue, setScenarioStateOverride, type ScenarioDraft, type ScenarioListOwner, type StepListPath } from './scenario-edit';

  let { open = $bindable(false), controlId = '', itemId = '', initialTrigger = 'press' }: {
    open?: boolean; controlId?: string; itemId?: string; initialTrigger?: Trigger;
  } = $props();
  // A slider's own value axis cannot also be a pull: those triggers stay visible but disabled.
  const blockedTriggers = $derived.by(() => {
    const item = placementById(settings.deck.pages, itemId)?.item;
    const type = controlById(controlId)?.type;
    if (type !== 'slider' || !item) return new Set<Trigger>();
    const allowed = availableGestures(type, item.w, item.h);
    return new Set<Trigger>((['swipeUp', 'swipeDown', 'swipeLeft', 'swipeRight'] as Trigger[]).filter(t => !allowed.includes(t as never)));
  });
  let draft = $state<ScenarioDraft | null>(null);
  let baseline = $state<ScenarioDraft | null>(null);
  let openedControl = '';
  let selectedKey = $state('trigger:press');
  let selectedState = $state('*');
  let selectedTab = $state<'scenario' | 'views' | 'binding'>('scenario');
  let pickerKey = $state<string | null>(null);
  let eventToAdd = $state('');
  let variablesOpen = $state(false);
  let manualFallbackStateId = '';
  let opener = $state<HTMLElement | null>(null);
  const control = $derived(controlById(controlId));
  const eventDefinitions = $derived(registeredEvents(Object.values($runtimeView.variables.records)));
  const previewPlacement = $derived(placementById(settings.deck.pages, itemId));
  const previewItem = $derived(previewPlacement?.item);
  const previewAspect = $derived.by(() => {
    if (!previewItem || !previewPlacement) return 1;
    const { size, gap } = previewPlacement.page;
    return (previewItem.w * size + (previewItem.w - 1) * gap) / (previewItem.h * size + (previewItem.h - 1) * gap);
  });
  const selectedEventId = $derived(selectedKey.startsWith('event:') ? selectedKey.slice(6) : '');
  const selectedEvent = $derived(draft?.scenario.events.find(event => event.id === selectedEventId));
  const selectedTrigger = $derived(selectedKey.startsWith('trigger:') ? selectedKey.slice(8) as Trigger : undefined);
  const sectionTitle = $derived(selectedTab === 'views' ? 'Views' : selectedTab === 'binding' ? 'Binding' : selectedEvent ? eventLabel(selectedEvent) : selectedTrigger ?
    ({ press: 'Press', release: 'Release', longPress: 'Long press', longPressRelease: 'Long press release', doubleTap: 'Double tap',
      swipeUp: 'Pull up', swipeDown: 'Pull down', swipeLeft: 'Pull left', swipeRight: 'Pull right' } as Record<Trigger, string>)[selectedTrigger] : 'Scenario');
  const owner = $derived<ScenarioListOwner | undefined>(selectedEvent
    ? { kind: 'event', eventId: selectedEvent.id }
    : selectedTrigger ? { kind: 'trigger', trigger: selectedTrigger } : undefined);
  const currentList = $derived(owner && draft ? owner.kind === 'trigger'
    ? draft.scenario.triggers[owner.trigger]
    : draft.scenario.events.find(event => event.id === owner.eventId)?.list : undefined);
  const hasOverride = $derived(selectedState !== '*' && !!currentList && Object.hasOwn(currentList.byState ?? {}, selectedState));
  const currentPath = $derived.by((): StepListPath | undefined => {
    if (!owner) return undefined;
    if (selectedState !== '*' && hasOverride) return { ...owner, stateId: selectedState };
    return owner;
  });
  const issues = $derived(draft ? validateScenario(draft.scenario) : []);
  const stateIssues = $derived(draft ? validateStateConfiguration({ variants: draft.variants,
    stateBinding: draft.stateBinding, stateRoles: draft.stateRoles }, $runtimeView.variables) : []);
  const newIssues = $derived.by(() => {
    const existing = new Set([...(baseline ? validateScenario(baseline.scenario) : []), ...(baseline && control
      ? validateStateConfiguration({ variants: baseline.variants, stateBinding: baseline.stateBinding, stateRoles: baseline.stateRoles }, $runtimeView.variables) : [])]
      .map(issue => `${issue.path}\u0000${issue.message}`));
    return [...issues, ...stateIssues].filter(issue => !existing.has(`${issue.path}\u0000${issue.message}`));
  });
  const conflict = $derived(!!baseline && !!control && !sameScenarioDraft(baseline, createScenarioDraft($state.snapshot(control))));
  const canSave = $derived(!!draft && !!baseline && !conflict && newIssues.length === 0 && !sameScenarioDraft(draft, baseline));
  const states = $derived(draft?.variants.map((variant, index) => ({
    value: variant.id ?? `state-${index + 1}`, label: variant.label || `State ${index + 1}`,
  })) ?? []);
  const stateOptions = $derived([{ value: '*', label: 'Common' }, ...states]);
  const anyPicker = $derived(pickerKey !== null);
  const isOverLimit = $derived(!!draft && scenarioNodeCount(draft.scenario) > 1000);
  let closeOnDelete = false;

  $effect(() => {
    const isOpen = open;
    const id = controlId;
    const source = control;
    if (!isOpen) { openedControl = ''; return; }
    if (!source) { open = false; return; }
    if (openedControl === id) return;
    openedControl = id;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    baseline = createScenarioDraft($state.snapshot(source));
    draft = cloneDraftValue(baseline);
    selectedKey = `trigger:${initialTrigger}`;
    selectedState = '*';
    selectedTab = 'scenario';
    pickerKey = null;
    eventToAdd = '';
    variablesOpen = false;
    manualFallbackStateId = '';
  });

  $effect(() => {
    if (!open || control) return;
    closeOnDelete = true;
    open = false;
  });

  onDestroy(() => {
    if (opener?.isConnected && !closeOnDelete) opener.focus();
  });

  function makeOverride() {
    if (!draft || !owner) return;
    const list = owner.kind === 'trigger' ? draft.scenario.triggers[owner.trigger]
      : draft.scenario.events.find(event => event.id === owner.eventId)?.list;
    const common = cloneDraftValue(list?.steps ?? []);
    draft = { ...draft, scenario: setScenarioStateOverride(draft.scenario, owner, selectedState, common) };
  }
  function clearOverride(stateId: string) {
    if (!draft || !owner) return;
    draft = { ...draft, scenario: setScenarioStateOverride(draft.scenario, owner, stateId, undefined) };
  }
  function removeOverride() {
    if (selectedState !== '*') clearOverride(selectedState);
  }
  function addEvent(eventId: string) {
    if (!draft || !eventDefinitions.some(event => event.id === eventId)) return;
    const listener: EventList = { id: newScenarioId(), eventId, list: { steps: [] } };
    draft = { ...draft, scenario: { ...draft.scenario, events: [...draft.scenario.events, listener] } };
    selectedKey = `event:${listener.id}`;
    selectedState = '*';
    eventToAdd = '';
  }
  function removeEvent(listenerId: string) {
    if (!draft) return;
    draft = { ...draft, scenario: { ...draft.scenario,
      events: draft.scenario.events.filter(event => event.id !== listenerId) } };
    if (selectedEventId === listenerId) selectedKey = 'trigger:press';
  }
  function eventDefinition(eventId: string) { return eventDefinitions.find(event => event.id === eventId); }
  function eventLabel(event: EventList) {
    const definition = eventDefinition(event.eventId);
    return `${definition?.title ?? event.eventId}${event.parameter ? ` · ${event.parameter}` : ''}`;
  }
  function stepCount(trigger: Trigger) {
    const list = draft?.scenario.triggers[trigger];
    return list ? list.steps.length + Object.values(list.byState ?? {}).reduce((sum, steps) => sum + steps.length, 0) : 0;
  }
  function eventStepCount(event: EventList) {
    return event.list.steps.length + Object.values(event.list.byState ?? {}).reduce((sum, steps) => sum + steps.length, 0);
  }
  function stateTitle(variant: Variant, index: number) {
    const id = variant.id ?? `state-${index + 1}`;
    if (draft?.stateRoles?.off === id) return 'Off';
    if (draft?.stateRoles?.on === id) return 'On';
    return `State ${index + 1}`;
  }
  function stateIndex(stateId: string) {
    const currentControl = control;
    const variants = draft?.variants ?? [];
    if (!currentControl) return -1;
    return variants.findIndex((_, index) => stateIdAt({ ...currentControl, variants }, index) === stateId);
  }
  function changeEventParameter(value: string) {
    if (!draft || !selectedEvent) return;
    draft = { ...draft, scenario: { ...draft.scenario, events: draft.scenario.events.map(event => event.id === selectedEvent.id
      ? { ...event, ...(value ? { parameter: value } : { parameter: undefined }) } : event) } };
  }
  function replaceVariant(index: number, variant: Variant) {
    if (!draft) return;
    const variants = [...draft.variants];
    variants[index] = cloneDraftValue(variant);
    draft = { ...draft, variants };
  }
  function cloneState(source: Variant): Variant {
    const variant = { ...cloneDraftValue(source), id: newScenarioId(), label: '' };
    delete variant.action;
    delete variant.value;
    return variant;
  }
  function addState() {
    if (!draft || !draft.variants.length) return;
    draft = { ...draft, variants: [...draft.variants, cloneState(draft.variants.at(-1)!)] };
  }
  function syncBooleanRoles(roles: { off: string; on: string } | undefined, next: ScenarioDraft) {
    const binding = next.stateBinding;
    const record = binding && $runtimeView.variables.records[binding.variableId];
    if (binding && record?.definition.type === 'boolean' && roles) next.stateBinding = { ...binding, cases: [
      { value: false, stateId: roles.off }, { value: true, stateId: roles.on },
    ] };
  }
  function updateRoles(roles: { off: string; on: string } | undefined) {
    if (!draft) return;
    const next = cloneDraftValue(draft);
    if (roles && (roles.off === roles.on || !next.variants.some((variant, index) => stateIdAt({ ...control!, variants: next.variants }, index) === roles.off) ||
      !next.variants.some((variant, index) => stateIdAt({ ...control!, variants: next.variants }, index) === roles.on))) return;
    if (roles) next.stateRoles = roles; else delete next.stateRoles;
    syncBooleanRoles(roles, next);
    draft = next;
  }
  function toggleRoles() {
    if (!draft) return;
    if (draft.stateRoles) { updateRoles(undefined); return; }
    let next = cloneDraftValue(draft);
    if (next.variants.length < 2) next.variants.push(cloneState(next.variants[0]));
    const first = stateIdAt({ ...control!, variants: next.variants }, 0);
    const second = stateIdAt({ ...control!, variants: next.variants }, 1);
    next.stateRoles = { off: first, on: second };
    syncBooleanRoles(next.stateRoles, next);
    draft = next;
  }
  function moveState(from: number, to: number) {
    if (!draft || from === to) return;
    const currentState = manualFallbackStateId || stateIdAt(control!, settings.variants[controlId] ?? 0);
    const next = cloneDraftValue(draft);
    const working = { ...structuredClone($state.snapshot(control!)), ...next };
    moveVariant(working, next.variants.findIndex((variant, index) => stateIdAt(working, index) === currentState), from, to);
    draft = { ...next, variants: working.variants };
  }
  function deleteState(index: number) {
    if (!draft || draft.variants.length < 2 || !control) return;
    const currentState = manualFallbackStateId || stateIdAt(control, settings.variants[controlId] ?? 0);
    const removedId = stateIdAt({ ...control, variants: draft.variants }, index);
    const next = cloneDraftValue(draft);
    const working = { ...structuredClone($state.snapshot(control)), ...next };
    const currentIndex = working.variants.findIndex((variant, i) => stateIdAt(working, i) === currentState);
    const nextIndex = removeVariant(working, currentIndex < 0 ? 0 : currentIndex, index);
    if (removedId === currentState) manualFallbackStateId = stateIdAt(working, nextIndex);
    draft = { ...next, variants: working.variants, scenario: working.scenario,
      ...(working.stateBinding ? { stateBinding: working.stateBinding } : { stateBinding: undefined }),
      ...(working.stateRoles ? { stateRoles: working.stateRoles } : { stateRoles: undefined }) };
    if (selectedState === removedId) selectedState = '*';
  }
  function updateBinding(binding: ScenarioDraft['stateBinding']) {
    if (!draft) return;
    draft = { ...draft, ...(binding ? { stateBinding: binding } : { stateBinding: undefined }) };
  }
  function closeAutoFocus(event: Event) {
    if (opener?.isConnected) {
      event.preventDefault();
      opener.focus();
    }
  }
  function keydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') event.stopPropagation();
  }
  function reloadDraft() {
    const latest = controlById(controlId);
    if (!latest) { open = false; return; }
    baseline = createScenarioDraft($state.snapshot(latest));
    draft = cloneDraftValue(baseline);
    selectedState = '*';
    pickerKey = null;
    manualFallbackStateId = '';
  }
  function save() {
    const latest = controlById(controlId);
    if (!latest || !draft || !baseline || conflict || newIssues.length || sameScenarioDraft(draft, baseline)) return;
    commit('Edit scenario');
    const replacement = structuredClone($state.snapshot(latest)) as ControlConfig;
    replacement.scenario = cloneDraftValue(draft.scenario);
    replacement.variants = cloneDraftValue(draft.variants);
    if (draft.stateBinding) replacement.stateBinding = cloneDraftValue(draft.stateBinding); else delete replacement.stateBinding;
    if (draft.stateRoles) replacement.stateRoles = cloneDraftValue(draft.stateRoles); else delete replacement.stateRoles;
    settings.controls = settings.controls.map(value => value.id === controlId ? replacement : value);
    const liveStateId = stateIdAt(latest, settings.variants[controlId] ?? 0);
    const selectedStateId = replacement.variants.some((variant, index) => stateIdAt(replacement, index) === liveStateId)
      ? liveStateId : manualFallbackStateId || liveStateId;
    const nextManualIndex = replacement.variants.findIndex((variant, index) => stateIdAt(replacement, index) === selectedStateId);
    if (nextManualIndex >= 0) settings.variants = { ...settings.variants, [controlId]: nextManualIndex };
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content aria-describedby={undefined} onkeydown={keydown} onCloseAutoFocus={closeAutoFocus}
    class="flex h-[min(760px,calc(100dvh-48px))] w-[min(1100px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0">
    <Dialog.Header class="flex min-h-14 shrink-0 flex-row flex-wrap items-center gap-2 border-b px-5 py-3 pr-14">
      <Dialog.Title class="min-w-0 flex-1 truncate text-left">Scenario · {control?.name ?? 'Unavailable'}</Dialog.Title>
      {#if draft && control}
        <h2 class="max-w-36 shrink-0 truncate text-sm font-semibold">{sectionTitle}</h2>
        <div role="tablist" aria-label="Scenario editor" class="flex shrink-0 items-center gap-1">
          <Button size="sm" variant={selectedTab === 'scenario' ? 'secondary' : 'ghost'} aria-pressed={selectedTab === 'scenario'}
            onclick={() => { selectedTab = 'scenario'; pickerKey = null; }}>Scenario</Button>
          <Button size="sm" variant={selectedTab === 'views' ? 'secondary' : 'ghost'} aria-pressed={selectedTab === 'views'}
            onclick={() => { selectedTab = 'views'; pickerKey = null; }}>Views</Button>
          <Button size="sm" variant={selectedTab === 'binding' ? 'secondary' : 'ghost'} aria-pressed={selectedTab === 'binding'}
            onclick={() => { selectedTab = 'binding'; pickerKey = null; }}>Binding</Button>
          <Button size="sm" variant="ghost" onclick={() => variablesOpen = true}>Variables</Button>
        </div>
        {#if selectedTab === 'scenario' && owner && draft.variants.length > 1}
          <div class="w-40 min-w-0"><Choice value={selectedState} options={stateOptions} aria-label="State scenario" onchange={value => { selectedState = value; pickerKey = null; }} /></div>
          {#if selectedState !== '*' && hasOverride}
            <Button variant="ghost" size="sm" onclick={removeOverride}>Remove override</Button>
          {:else if selectedState !== '*'}
            <Button variant="outline" size="sm" onclick={makeOverride}>Override</Button>
          {/if}
        {/if}
      {/if}
    </Dialog.Header>

    {#if draft && control}
      <div class="grid min-h-0 min-w-0 flex-1 grid-cols-[176px_minmax(0,1fr)_240px] max-[900px]:grid-cols-[144px_minmax(0,1fr)]">
        <nav aria-label="Scenario triggers" class="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto border-r p-3 [scrollbar-gutter:stable]">
          {#each TRIGGERS as trigger (trigger)}
            {@const label = ({ press: 'Press', release: 'Release', longPress: 'Long press', longPressRelease: 'Long press release', doubleTap: 'Double tap',
              swipeUp: 'Pull up', swipeDown: 'Pull down', swipeLeft: 'Pull left', swipeRight: 'Pull right' } as Record<Trigger, string>)[trigger]}
            <Button variant={selectedKey === `trigger:${trigger}` ? 'secondary' : 'ghost'} size="sm" class="min-w-0 justify-between gap-2"
              disabled={blockedTriggers.has(trigger)}
              aria-label={`${label}, ${stepCount(trigger)} steps`} aria-pressed={selectedKey === `trigger:${trigger}`}
              onclick={() => { selectedKey = `trigger:${trigger}`; selectedState = '*'; selectedTab = 'scenario'; pickerKey = null; }}>
              <span class="truncate">{label}</span><span class="shrink-0 text-xs tabular-nums text-muted-foreground">{stepCount(trigger)}</span>
            </Button>
          {/each}
          <div class="mt-2 grid gap-2 border-t pt-3">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-xs font-semibold text-muted-foreground">Events</h3>
              <span class="text-xs tabular-nums text-muted-foreground">{draft.scenario.events.length}</span>
            </div>
            {#each draft.scenario.events as event (event.id)}
              {@const definition = eventDefinition(event.eventId)}
              {@const providerTitle = pluginTitle(definition?.plugin)}
              <div class="flex min-w-0 items-center gap-1">
                <Button variant={selectedKey === `event:${event.id}` ? 'secondary' : 'ghost'} size="sm" class="min-w-0 flex-1 justify-start truncate"
                  aria-label={`${eventLabel(event)}, ${eventStepCount(event)} steps${providerTitle ? `, Plugin: ${providerTitle}` : ''}`} aria-pressed={selectedKey === `event:${event.id}`}
                  onclick={() => { selectedKey = `event:${event.id}`; selectedState = '*'; selectedTab = 'scenario'; pickerKey = null; }}>
                  <span class="truncate">{eventLabel(event)}</span>
                  <PluginMark plugin={definition?.plugin} />
                  <span class="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{eventStepCount(event)}</span>
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Remove event listener" onclick={() => removeEvent(event.id)}><Trash /></Button>
              </div>
            {/each}
            {#if eventDefinitions.length}
              <Choice value={eventToAdd} placeholder="Add event" options={eventDefinitions.map(event => ({ value: event.id, label: event.title, plugin: event.plugin }))}
                onchange={addEvent} />
            {/if}
          </div>
        </nav>

        <main class="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {#if selectedTab === 'scenario' && selectedEvent}
            {@const event = eventDefinition(selectedEvent.eventId)}
            {@const parameterOptions = typeof event?.parameterSuggestions === 'function' ? event.parameterSuggestions() : event?.parameterSuggestions ?? []}
            <div class="grid shrink-0 gap-1.5 border-b px-4 py-3">
              <Label class="text-xs text-muted-foreground">Parameter filter</Label>
              <Choice value={selectedEvent.parameter ?? ''} placeholder="Any parameter"
                options={[{ value: '', label: 'Any parameter' }, ...parameterOptions,
                  ...(selectedEvent.parameter && !parameterOptions.some(option => option.value === selectedEvent.parameter)
                    ? [{ value: selectedEvent.parameter, label: `Unavailable · ${selectedEvent.parameter}` }] : [])]}
                onchange={changeEventParameter} />
            </div>
          {/if}
          {#if selectedTab === 'views'}
            <StateViewEditor variants={draft.variants} roles={draft.stateRoles} aspectRatio={previewAspect}
              onvariant={replaceVariant} onroles={updateRoles} ontoggleroles={toggleRoles}
              onadd={addState} onremove={deleteState} onmove={moveState} />
          {:else if selectedTab === 'binding'}
            <StateBindingEditor binding={draft.stateBinding} variants={draft.variants} roles={draft.stateRoles} onchange={updateBinding} />
          {:else}
            <div class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 [scrollbar-gutter:stable]">
              {#if !owner}
                <!-- No trigger is selected. -->
              {:else if selectedState !== '*' && !hasOverride}
                <Button variant="outline" size="sm" onclick={makeOverride}>Override common steps</Button>
              {:else if selectedState === '*' && currentList && Object.keys(currentList.byState ?? {}).length}
                <div class="grid min-w-0 gap-3">
                  <section class="grid min-w-0 gap-3 rounded-lg border p-3" aria-label="Common steps">
                    <div class="flex min-w-0 items-center"><span class="rounded-full border px-2.5 py-1 text-xs font-medium">Common</span></div>
                    <ScenarioSteps {draft} path={owner!} pickerKey={anyPicker ? pickerKey : null}
                      onpickerchange={value => pickerKey = value} onchange={value => draft = value} />
                  </section>
                  {#each Object.entries(currentList.byState ?? {}) as [stateId, stateSteps] (stateId)}
                    {@const index = stateIndex(stateId)}
                    <section class="grid min-w-0 gap-3 rounded-lg border p-3"
                      aria-label={index < 0 ? 'Unavailable state steps' : `${stateTitle(draft.variants[index], index)} steps`}>
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <span class="rounded-full border px-2.5 py-1 text-xs font-medium">{index < 0 ? 'Unavailable' : stateTitle(draft.variants[index], index)}</span>
                        {#if index >= 0 && draft.variants[index].label}
                          <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{draft.variants[index].label}</span>
                        {:else if index < 0}
                          <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{stateId}</span>
                        {/if}
                        <Button variant="ghost" size="sm" onclick={() => clearOverride(stateId)}>Clear override</Button>
                      </div>
                      <ScenarioSteps {draft} path={{ ...owner!, stateId }} pickerKey={anyPicker ? pickerKey : null}
                        onpickerchange={value => pickerKey = value} onchange={value => draft = value} />
                    </section>
                  {/each}
                </div>
              {:else}
                <ScenarioSteps {draft} path={currentPath!} pickerKey={anyPicker ? pickerKey : null}
                  onpickerchange={value => pickerKey = value} onchange={value => draft = value} />
              {/if}
            </div>
          {/if}
        </main>

        <aside class="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto border-l p-4 [scrollbar-gutter:stable] max-[900px]:hidden">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">States</h2>
          {#each draft.variants as variant, index (variant.id ?? index)}
            <div class="grid min-w-0 gap-1 rounded-lg border bg-card p-3">
              <span class="truncate text-sm font-medium">{stateTitle(variant, index)}</span>
              <div class="flex min-w-0 gap-2 text-xs text-muted-foreground">
                <span class="min-w-0 flex-1 truncate">{variant.label || '—'}</span>
                {#if variant.icon}<span class="shrink-0">{variant.icon}</span>{/if}
              </div>
            </div>
          {/each}
        </aside>
      </div>
    {/if}

    <Dialog.Footer class="mx-0 mb-0 flex min-h-14 shrink-0 items-center justify-between gap-3 border-t px-6 py-3">
      <div class="min-w-0 flex-1" aria-live="polite">
        {#if conflict}
          <div class="flex items-center gap-2 text-sm text-destructive"><span>Changed elsewhere</span><Button variant="outline" size="sm" onclick={reloadDraft}>Reload</Button></div>
        {:else if newIssues.length}
          <span class="text-sm text-destructive">{newIssues[0].message}</span>
        {:else if isOverLimit}
          <span class="text-sm text-destructive">Scenario exceeds 1000 steps</span>
        {/if}
      </div>
      <div class="flex shrink-0 gap-2">
        <Dialog.Close><Button variant="ghost" size="sm">Cancel</Button></Dialog.Close>
        <Button size="sm" disabled={!canSave || isOverLimit} onclick={save}>Save</Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
  <VariablesEditor bind:open={variablesOpen} />
</Dialog.Root>

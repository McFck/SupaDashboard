// The scenario editor's working copy of one control. Edits stay in the draft until save() writes them back as one
// settings change with one undo step; a change made elsewhere meanwhile is reported as a conflict.
import { fromStore } from 'svelte/store';
import {
  isEmptyList,
  MAX_SCENARIO_NODES,
  newId,
  TRIGGERS,
  scenarioNodeCount,
  type EventList,
  type ScenarioIssue,
  type StateRoles,
  type Trigger,
} from '../scenario';
import { validateScenario } from '../validate';
import { clonePlain } from '../plain-data';
import type { ControlConfig, Variant } from '../../controls/model';
import { stateIdAt } from '../../controls/variants';
import { validateStateConfiguration } from '../../controls/state-validation';
import { runtimeView } from '../../../app/runtime/state';
import { controlTriggers, controlTypes, registeredEvents } from '../../plugins/registry';
import { controlById, settings } from '../../settings/state.svelte';
import { commit } from '../../layout/history.svelte';
import { layoutFor, placementById } from '../../layout/applet-layouts';
import { controlUseCount } from '../../layout/placements';
import { newControlId, writeSlotItems } from '../../layout/slot-edits';
import {
  createScenarioDraft,
  listOf,
  sameScenarioDraft,
  setScenarioStateOverride,
  withNewStepIds,
  type ScenarioDraft,
  type ScenarioListOwner,
  type StepListPath,
} from './scenario-edit';
import {
  withAddedState,
  withMovedState,
  withoutState,
  withRoles,
  withToggledRoles,
} from './draft-states';

export type ScenarioEditorTab = 'scenario' | 'views' | 'binding' | 'variables';

const issueKey = (issue: ScenarioIssue) => `${issue.path}\u0000${issue.message}`;

export class ScenarioDraftEditor {
  // Assigned in the constructor; the derived fields below read it lazily.
  private readonly controlId: () => string = () => '';
  draft = $state<ScenarioDraft | null>(null);
  baseline = $state<ScenarioDraft | null>(null);
  selectedKey = $state('trigger:press');
  selectedState = $state('*');
  selectedTab = $state<ScenarioEditorTab>('scenario');
  /** The step list whose action picker is open, so only one picker shows at a time. */
  pickerKey = $state<string | null>(null);

  private readonly runtime = fromStore(runtimeView);
  /** The state to land on after save when the draft deleted the live state. */
  private manualFallbackStateId = '';

  readonly control = $derived(controlById(this.controlId()));
  readonly triggers = $derived(controlTriggers(this.control?.type ?? ''));
  /** Content tiles and trigger-restricted types have no views or state bindings. */
  readonly stateless = $derived(
    this.control?.type === 'media' ||
      this.control?.type === 'web' ||
      !!controlTypes.get(this.control?.type ?? '')?.triggers,
  );
  readonly tabs = $derived<ScenarioEditorTab[]>(
    this.stateless ? ['scenario', 'variables'] : ['scenario', 'views', 'binding', 'variables'],
  );
  readonly eventDefinitions = $derived(
    registeredEvents(Object.values(this.runtime.current.variables.records)),
  );
  readonly selectedEvent = $derived.by(() => {
    const id = this.selectedKey.startsWith('event:') ? this.selectedKey.slice(6) : '';
    return this.draft?.scenario.events.find((event) => event.id === id);
  });
  readonly selectedTrigger = $derived(
    this.selectedKey.startsWith('trigger:') ? (this.selectedKey.slice(8) as Trigger) : undefined,
  );
  readonly owner = $derived.by((): ScenarioListOwner | undefined => {
    if (this.selectedEvent) {
      return { kind: 'event', eventId: this.selectedEvent.id };
    }
    if (this.selectedTrigger) {
      return { kind: 'trigger', trigger: this.selectedTrigger };
    }
    return undefined;
  });
  readonly currentList = $derived.by(() => {
    const owner = this.owner;
    if (!owner || !this.draft) {
      return undefined;
    }
    return listOf(this.draft.scenario, owner);
  });
  readonly hasOverride = $derived(
    this.selectedState !== '*' &&
      !!this.currentList &&
      Object.hasOwn(this.currentList.byState ?? {}, this.selectedState),
  );
  readonly currentPath = $derived.by((): StepListPath | undefined => {
    if (!this.owner) {
      return undefined;
    }
    if (this.hasOverride) {
      return { ...this.owner, stateId: this.selectedState };
    }
    return this.owner;
  });
  /** Only issues the draft introduced block saving; ones already stored on the control do not. */
  readonly newIssues = $derived.by(() => {
    if (!this.draft) {
      return [];
    }
    const existing = new Set(this.baseline ? this.issuesOf(this.baseline).map(issueKey) : []);
    return this.issuesOf(this.draft).filter((issue) => !existing.has(issueKey(issue)));
  });
  readonly conflict = $derived(
    !!this.baseline &&
      !!this.control &&
      !sameScenarioDraft(this.baseline, createScenarioDraft($state.snapshot(this.control))),
  );
  readonly isOverLimit = $derived(
    !!this.draft && scenarioNodeCount(this.draft.scenario) > MAX_SCENARIO_NODES,
  );
  readonly canSave = $derived(
    !!this.draft &&
      !!this.baseline &&
      !this.conflict &&
      this.newIssues.length === 0 &&
      !this.isOverLimit &&
      !sameScenarioDraft(this.draft, this.baseline),
  );
  readonly stateOptions = $derived([
    { value: '*', label: 'Common' },
    ...(this.draft?.variants.map((variant, index) => ({
      value: stateIdAt({ variants: this.draft?.variants ?? [] }, index),
      label: variant.label || `State ${index + 1}`,
      appearance: variant,
    })) ?? []),
  ]);

  constructor(controlId: () => string) {
    this.controlId = controlId;
  }

  /** Starts a fresh draft of the control's current configuration. */
  open(initialTrigger: Trigger) {
    this.reload();
    this.selectedKey = `trigger:${initialTrigger}`;
    this.selectedTab = 'scenario';
  }

  /** Replaces the draft with the stored configuration; false when the control no longer exists. */
  reload() {
    const latest = controlById(this.controlId());
    if (!latest) {
      return false;
    }
    this.baseline = createScenarioDraft($state.snapshot(latest));
    this.draft = clonePlain(this.baseline);
    this.selectedState = '*';
    this.pickerKey = null;
    this.manualFallbackStateId = '';
    return true;
  }

  private buildReplacement(latest: ControlConfig, draft: ScenarioDraft, id: string): ControlConfig {
    const replacement = { ...($state.snapshot(latest) as ControlConfig), id };
    replacement.scenario = clonePlain(draft.scenario);
    for (const trigger of TRIGGERS) {
      if (isEmptyList(replacement.scenario.triggers[trigger])) {
        delete replacement.scenario.triggers[trigger];
      }
    }
    replacement.variants = clonePlain(draft.variants);
    if (draft.stateBindings?.length) {
      replacement.stateBindings = clonePlain(draft.stateBindings);
    } else {
      delete replacement.stateBindings;
    }
    if (draft.stateRoles) {
      replacement.stateRoles = clonePlain(draft.stateRoles);
    } else {
      delete replacement.stateRoles;
    }
    return replacement;
  }

  private resolvedStateIndex(latest: ControlConfig, replacement: ControlConfig) {
    // Keep the button on its live state, or on the fallback chosen when that state was deleted.
    const liveStateId = stateIdAt(latest, settings.variants[latest.id] ?? 0);
    const liveStateKept = replacement.variants.some(
      (_, index) => stateIdAt(replacement, index) === liveStateId,
    );
    const stateId = liveStateKept ? liveStateId : this.manualFallbackStateId || liveStateId;
    return replacement.variants.findIndex(
      (_, position) => stateIdAt(replacement, position) === stateId,
    );
  }

  /** Writes the draft back as one undo step. Returns whether it saved. */
  save() {
    const controlId = this.controlId();
    const latest = controlById(controlId);
    const draft = this.draft;
    if (!latest || !draft || !this.canSave) {
      return false;
    }
    commit('Edit scenario');
    const replacement = this.buildReplacement(latest, draft, controlId);
    settings.controls = settings.controls.map((value) =>
      value.id === controlId ? replacement : value,
    );
    const index = this.resolvedStateIndex(latest, replacement);
    if (index >= 0) {
      settings.variants = { ...settings.variants, [controlId]: index };
    }
    return true;
  }

  /** Detaches `itemId` into a new control with the draft applied, as one undo step. */
  saveAsUnique(itemId: string) {
    const controlId = this.controlId();
    const latest = controlById(controlId);
    const draft = this.draft;
    const placement = placementById(settings, itemId);
    if (
      !latest ||
      !draft ||
      !this.canSave ||
      !placement ||
      placement.item.control !== controlId ||
      controlUseCount(settings, controlId) < 2
    ) {
      return false;
    }
    const target = {
      appletId: placement.appletId,
      pageId: placement.pageId,
      slotId: placement.slotId,
    };
    const current = layoutFor(settings, target.appletId, target.pageId, target.slotId);
    if (!current) {
      return false;
    }
    const replacement = this.buildReplacement(latest, draft, newControlId(latest.name));
    const nextItems = current.items.map((entry) =>
      entry.id === itemId ? { ...entry, control: replacement.id } : entry,
    );
    if (!writeSlotItems(target, nextItems, 'Save scenario as unique', replacement)) {
      return false;
    }
    const index = this.resolvedStateIndex(latest, replacement);
    if (index >= 0) {
      settings.variants = { ...settings.variants, [replacement.id]: index };
    }
    return true;
  }

  selectList(key: string) {
    this.selectedKey = key;
    this.selectedState = '*';
    this.selectedTab = 'scenario';
    this.pickerKey = null;
  }

  selectTab(tab: ScenarioEditorTab) {
    this.selectedTab = tab;
    this.pickerKey = null;
  }

  selectState(stateId: string) {
    this.selectedState = stateId;
    this.pickerKey = null;
  }

  update(draft: ScenarioDraft) {
    this.draft = draft;
  }

  stateTitle(variant: Variant, index: number) {
    const id = variant.id ?? `state-${index + 1}`;
    if (this.draft?.stateRoles?.off === id) {
      return 'Off';
    }
    if (this.draft?.stateRoles?.on === id) {
      return 'On';
    }
    return `State ${index + 1}`;
  }

  stateIndex(stateId: string) {
    const control = this.control;
    const variants = this.draft?.variants ?? [];
    if (!control) {
      return -1;
    }
    return variants.findIndex((_, index) => stateIdAt({ ...control, variants }, index) === stateId);
  }

  eventDefinition(eventId: string) {
    return this.eventDefinitions.find((event) => event.id === eventId);
  }

  eventLabel(event: EventList) {
    const title = this.eventDefinition(event.eventId)?.title ?? event.eventId;
    return event.parameter ? `${title}: ${event.parameter}` : title;
  }

  makeOverride() {
    const draft = this.draft;
    if (!draft || !this.owner) {
      return;
    }
    // Fresh IDs: step IDs are unique across the whole scenario.
    const common = withNewStepIds(this.currentList?.steps ?? []);
    this.draft = {
      ...draft,
      scenario: setScenarioStateOverride(draft.scenario, this.owner, this.selectedState, common),
    };
  }

  clearOverride(stateId = this.selectedState) {
    const draft = this.draft;
    if (!draft || !this.owner || stateId === '*') {
      return;
    }
    this.draft = {
      ...draft,
      scenario: setScenarioStateOverride(draft.scenario, this.owner, stateId, undefined),
    };
  }

  addEvent(eventId: string) {
    const draft = this.draft;
    if (!draft || !this.eventDefinitions.some((event) => event.id === eventId)) {
      return;
    }
    const listener: EventList = { id: newId(), eventId, list: { steps: [] } };
    this.draft = {
      ...draft,
      scenario: { ...draft.scenario, events: [...draft.scenario.events, listener] },
    };
    this.selectedKey = `event:${listener.id}`;
    this.selectedState = '*';
  }

  removeEvent(listenerId: string) {
    const draft = this.draft;
    if (!draft) {
      return;
    }
    const events = draft.scenario.events.filter((event) => event.id !== listenerId);
    this.draft = { ...draft, scenario: { ...draft.scenario, events } };
    if (this.selectedEvent?.id === listenerId) {
      this.selectedKey = 'trigger:press';
    }
  }

  changeEventParameter(value: string) {
    const draft = this.draft;
    const selected = this.selectedEvent;
    if (!draft || !selected) {
      return;
    }
    const events = draft.scenario.events.map((event) =>
      event.id === selected.id ? { ...event, parameter: value || undefined } : event,
    );
    this.draft = { ...draft, scenario: { ...draft.scenario, events } };
  }

  replaceVariant(index: number, variant: Variant) {
    const draft = this.draft;
    if (!draft) {
      return;
    }
    const variants = [...draft.variants];
    variants[index] = clonePlain(variant);
    this.draft = { ...draft, variants };
  }

  addState() {
    const next = this.draft && withAddedState(this.draft);
    if (next) {
      this.draft = next;
    }
  }

  updateRoles(roles: StateRoles | undefined) {
    const next =
      this.draft && this.control && withRoles(this.draft, this.control, roles, this.records);
    if (next) {
      this.draft = next;
    }
  }

  toggleRoles() {
    const next =
      this.draft && this.control && withToggledRoles(this.draft, this.control, this.records);
    if (next) {
      this.draft = next;
    }
  }

  moveState(from: number, to: number) {
    const draft = this.draft;
    const control = this.control;
    if (!draft || !control || from === to) {
      return;
    }
    const live = this.manualFallbackStateId || this.liveStateId(control);
    this.draft = withMovedState(draft, $state.snapshot(control), live, from, to);
  }

  /** Deletes a state and repairs references to it; the live state falls back to its replacement. */
  deleteState(index: number) {
    const draft = this.draft;
    const control = this.control;
    if (!draft || draft.variants.length < 2 || !control) {
      return;
    }
    const live = this.manualFallbackStateId || this.liveStateId(control);
    const result = withoutState(draft, $state.snapshot(control), live, index);
    if (result.removedId === live) {
      this.manualFallbackStateId = result.replacementId;
    }
    this.draft = result.draft;
    if (this.selectedState === result.removedId) {
      this.selectedState = '*';
    }
  }

  updateBindings(bindings: ScenarioDraft['stateBindings']) {
    const draft = this.draft;
    if (draft) {
      this.draft = { ...draft, stateBindings: bindings };
    }
  }

  private liveStateId(control: ControlConfig) {
    return stateIdAt(control, settings.variants[this.controlId()] ?? 0);
  }

  private get records() {
    return this.runtime.current.variables.records;
  }

  private issuesOf(draft: ScenarioDraft): ScenarioIssue[] {
    const stateIssues = validateStateConfiguration(
      {
        variants: draft.variants,
        stateBindings: draft.stateBindings,
        stateRoles: draft.stateRoles,
      },
      this.runtime.current.variables,
    );
    return [...validateScenario(draft.scenario), ...stateIssues];
  }
}

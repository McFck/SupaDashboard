// The scenario editor's working copy of one control. Edits stay in the draft until save() writes them back as one
// settings change with one undo step; a change made elsewhere meanwhile is reported as a conflict.
import { fromStore } from 'svelte/store';
import {
  MAX_SCENARIO_NODES,
  newScenarioId,
  validateScenario,
  type EventList,
  type Trigger,
} from '../scenario';
import {
  MAX_VARIANTS,
  moveVariant,
  removeVariant,
  type ControlConfig,
  type Variant,
} from '../../controls/model';
import { stateIdAt, validateStateConfiguration } from '../../controls/button-state';
import { runtimeView } from '../../../app/runtime/state';
import { registeredEvents } from '../../plugins/registry';
import { controlById, settings } from '../../settings/state.svelte';
import { commit } from '../../layout/history.svelte';
import {
  cloneDraftValue,
  createScenarioDraft,
  newStateFrom,
  sameScenarioDraft,
  scenarioNodeCount,
  setScenarioStateOverride,
  withNewStepIds,
  type ScenarioDraft,
  type ScenarioListOwner,
  type StepListPath,
} from './scenario-edit';

export type ScenarioEditorTab = 'scenario' | 'views' | 'binding' | 'variables';
type StateRoles = { off: string; on: string };
type Issue = { path: string; message: string };

const issueKey = (issue: Issue) => `${issue.path}\u0000${issue.message}`;

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
  readonly contentControl = $derived(
    this.control?.type === 'media' || this.control?.type === 'web',
  );
  readonly tabs = $derived<ScenarioEditorTab[]>(
    this.contentControl ? ['scenario', 'variables'] : ['scenario', 'views', 'binding', 'variables'],
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
    if (owner.kind === 'trigger') {
      return this.draft.scenario.triggers[owner.trigger];
    }
    return this.draft.scenario.events.find((event) => event.id === owner.eventId)?.list;
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
    if (this.selectedState !== '*' && this.hasOverride) {
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
      value: variant.id ?? `state-${index + 1}`,
      label: variant.label || `State ${index + 1}`,
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
    this.draft = cloneDraftValue(this.baseline);
    this.selectedState = '*';
    this.pickerKey = null;
    this.manualFallbackStateId = '';
    return true;
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
    const replacement = structuredClone($state.snapshot(latest)) as ControlConfig;
    replacement.scenario = cloneDraftValue(draft.scenario);
    replacement.variants = cloneDraftValue(draft.variants);
    if (draft.stateBinding) {
      replacement.stateBinding = cloneDraftValue(draft.stateBinding);
    } else {
      delete replacement.stateBinding;
    }
    if (draft.stateRoles) {
      replacement.stateRoles = cloneDraftValue(draft.stateRoles);
    } else {
      delete replacement.stateRoles;
    }
    settings.controls = settings.controls.map((value) =>
      value.id === controlId ? replacement : value,
    );

    // Keep the button on its live state, or on the fallback chosen when that state was deleted.
    const liveStateId = stateIdAt(latest, settings.variants[controlId] ?? 0);
    const liveStateKept = replacement.variants.some(
      (_, index) => stateIdAt(replacement, index) === liveStateId,
    );
    const stateId = liveStateKept ? liveStateId : this.manualFallbackStateId || liveStateId;
    const index = replacement.variants.findIndex(
      (_, position) => stateIdAt(replacement, position) === stateId,
    );
    if (index >= 0) {
      settings.variants = { ...settings.variants, [controlId]: index };
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
    return event.parameter ? `${title} · ${event.parameter}` : title;
  }

  // ---- per-state overrides ----

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

  // ---- event listeners ----

  addEvent(eventId: string) {
    const draft = this.draft;
    if (!draft || !this.eventDefinitions.some((event) => event.id === eventId)) {
      return;
    }
    const listener: EventList = { id: newScenarioId(), eventId, list: { steps: [] } };
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

  // ---- states, roles and binding ----

  replaceVariant(index: number, variant: Variant) {
    const draft = this.draft;
    if (!draft) {
      return;
    }
    const variants = [...draft.variants];
    variants[index] = cloneDraftValue(variant);
    this.draft = { ...draft, variants };
  }

  addState() {
    const draft = this.draft;
    if (!draft || !draft.variants.length || draft.variants.length >= MAX_VARIANTS) {
      return;
    }
    this.draft = { ...draft, variants: [...draft.variants, newStateFrom(draft.variants.at(-1)!)] };
  }

  updateRoles(roles: StateRoles | undefined) {
    const draft = this.draft;
    const control = this.control;
    if (!draft || !control) {
      return;
    }
    const next = cloneDraftValue(draft);
    const ids = next.variants.map((_, index) =>
      stateIdAt({ ...control, variants: next.variants }, index),
    );
    if (roles && (roles.off === roles.on || !ids.includes(roles.off) || !ids.includes(roles.on))) {
      return;
    }
    if (roles) {
      next.stateRoles = roles;
    } else {
      delete next.stateRoles;
    }
    this.syncBooleanBinding(next);
    this.draft = next;
  }

  /** Turns Off/On roles on (using the first two states, adding one if needed) or off. */
  toggleRoles() {
    const draft = this.draft;
    const control = this.control;
    if (!draft || !control) {
      return;
    }
    if (draft.stateRoles) {
      this.updateRoles(undefined);
      return;
    }
    const next = cloneDraftValue(draft);
    if (next.variants.length < 2) {
      next.variants.push(newStateFrom(next.variants[0]));
    }
    const working = { ...control, variants: next.variants };
    next.stateRoles = { off: stateIdAt(working, 0), on: stateIdAt(working, 1) };
    this.syncBooleanBinding(next);
    this.draft = next;
  }

  moveState(from: number, to: number) {
    const draft = this.draft;
    const control = this.control;
    if (!draft || !control || from === to) {
      return;
    }
    const currentState = this.manualFallbackStateId || this.liveStateId(control);
    const next = cloneDraftValue(draft);
    const working = { ...structuredClone($state.snapshot(control)), ...next };
    const current = next.variants.findIndex(
      (_, index) => stateIdAt(working, index) === currentState,
    );
    moveVariant(working, current, from, to);
    this.draft = { ...next, variants: working.variants };
  }

  /** Deletes a state and repairs references to it; the live state falls back to its replacement. */
  deleteState(index: number) {
    const draft = this.draft;
    const control = this.control;
    if (!draft || draft.variants.length < 2 || !control) {
      return;
    }
    const currentState = this.manualFallbackStateId || this.liveStateId(control);
    const removedId = stateIdAt({ ...control, variants: draft.variants }, index);
    const next = cloneDraftValue(draft);
    const working = { ...structuredClone($state.snapshot(control)), ...next };
    const currentIndex = working.variants.findIndex(
      (_, i) => stateIdAt(working, i) === currentState,
    );
    const nextIndex = removeVariant(working, currentIndex < 0 ? 0 : currentIndex, index);
    if (removedId === currentState) {
      this.manualFallbackStateId = stateIdAt(working, nextIndex);
    }
    this.draft = {
      ...next,
      variants: working.variants,
      scenario: working.scenario,
      stateBinding: working.stateBinding,
      stateRoles: working.stateRoles,
    };
    if (this.selectedState === removedId) {
      this.selectedState = '*';
    }
  }

  updateBinding(binding: ScenarioDraft['stateBinding']) {
    const draft = this.draft;
    if (draft) {
      this.draft = { ...draft, stateBinding: binding };
    }
  }

  private liveStateId(control: ControlConfig) {
    return stateIdAt(control, settings.variants[this.controlId()] ?? 0);
  }

  private issuesOf(draft: ScenarioDraft): Issue[] {
    const stateIssues = validateStateConfiguration(
      { variants: draft.variants, stateBinding: draft.stateBinding, stateRoles: draft.stateRoles },
      this.runtime.current.variables,
    );
    return [...validateScenario(draft.scenario), ...stateIssues];
  }

  /** A Boolean binding follows the Off/On roles: false shows Off, true shows On. */
  private syncBooleanBinding(next: ScenarioDraft) {
    const binding = next.stateBinding;
    const roles = next.stateRoles;
    const record = binding && this.runtime.current.variables.records[binding.variableId];
    if (binding && roles && record?.definition.type === 'boolean') {
      next.stateBinding = {
        ...binding,
        cases: [
          { value: false, stateId: roles.off },
          { value: true, stateId: roles.on },
        ],
      };
    }
  }
}

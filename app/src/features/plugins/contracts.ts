// Plugin contracts: the API that bundled features and plugins register through.
// Type-only, so importing it never initializes registries, settings, storage, or the runtime.
import type { Component } from 'svelte';
import type { ControlConfig, ControlFaceProps } from '../controls/model';
import type { SkinDef } from '../skins/contracts';
import type { VariableDefinition, VariableRecord, VariableValue } from '../automation/variables';

/** A reference to an action plus its arguments, as stored in settings. */
export type ActionRef = { id: string; args?: Record<string, unknown> };

export type Option = {
  value: string;
  label: string;
  plugin?: string;
  detail?: string;
  unavailable?: boolean;
};
export type EventAncestry = { depth: number; listeners: string[] };

export type ActionContext = {
  signal: AbortSignal;
  controlId: string;
  eventAncestry?: EventAncestry;
  setVariable(id: string, value: VariableValue, ancestry?: EventAncestry): Promise<boolean>;
  getVariant(controlId: string): string | undefined;
  setVariant(controlId: string, stateId: string): Promise<void> | void;
  emitEvent(
    id: string,
    parameter?: string,
    payload?: unknown,
    ancestry?: EventAncestry,
  ): Promise<void>;
};

export type EventDef = {
  plugin?: string;
  id: string;
  title: string;
  parameterSuggestions?: Option[] | (() => Option[]);
};
export type PluginVariableDef = Omit<VariableDefinition, 'owner' | 'available'>;

/** Describes one argument so the editor can render a form for any action, including plugin ones. */
export type Param = {
  key: string;
  label: string;
  /** 'select' = dropdown of `suggestions` only; 'text' = free text with suggestions. */
  type: 'text' | 'number' | 'select' | 'boolean';
  /** Offered values. A function is re-read each time the editor opens. */
  suggestions?: Option[] | ((args?: Record<string, unknown>) => Option[]);
  /** Reloads whatever `suggestions` reads; called when the dropdown opens. */
  refresh?: (args?: Record<string, unknown>) => Promise<unknown>;
  default?: unknown;
};

export type ActionDef = {
  plugin?: string;
  id: string;
  title: string;
  params?: Param[];
  bindableVariable?(args: Record<string, unknown>): string | undefined;
  run(args: Record<string, unknown>, context?: ActionContext): unknown | Promise<unknown>;
};

/** Something a slider can read and write (system volume, an app's volume, brightness...). */
export type ValueRef = { id: string; args?: Record<string, unknown> };
export type ValueDef = {
  plugin?: string;
  id: string;
  title: string;
  params?: Param[];
  /** 0..1, or null when unavailable (e.g. the app isn't running). */
  get(args: Record<string, unknown>): Promise<number | null>;
  set(args: Record<string, unknown>, value: number): Promise<unknown>;
};

/** A widget type. Sizes are in deck cells. */
export type ControlTypeDef = {
  plugin?: string;
  type: string;
  title: string;
  icon: string;
  component: Component<any>;
  /** Presentation-only renderer; behavior and interaction remain in the control component. */
  face?: Component<ControlFaceProps>;
  size: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  /** Starting configuration when added from the palette. */
  create(): Omit<ControlConfig, 'id' | 'type'>;
};

/** Where media commands go: Windows' current player, or a specific app supplied by a plugin. */
export type MediaSource = {
  plugin?: string;
  id: string;
  title: string;
  command(command: 'prev' | 'next' | 'toggle' | 'play' | 'pause'): Promise<unknown>;
};

export type PluginApi = {
  registerAction(def: ActionDef): void;
  registerValue(def: ValueDef): void;
  registerControl(def: ControlTypeDef): void;
  registerSkin(def: SkinDef): void;
  registerMediaSource(def: MediaSource): void;
  registerVariable(def: PluginVariableDef): void;
  listVariables(): VariableRecord[];
  setVariable(id: string, value: VariableValue): Promise<boolean>;
  /** A custom icon (24×24 SVG path, drawn as an outline) usable anywhere icons are chosen. */
  registerIcon(name: string, path: string): void;
  /** Icon shown for an app in the volume mixer, keyed by process name ("spotify"). */
  registerAppIcon(app: string, icon: string): void;
};

export type Plugin = {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  author?: string;
  version?: string;
  updated?: string;
  size?: number | string;
  default?: boolean;
  source?: string;
  settings?: Component;
  /** Part of the app itself: not listed on the Plugins page. */
  builtin?: boolean;
  setup(api: PluginApi): void;
};

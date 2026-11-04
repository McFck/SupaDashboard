// Plugin contracts: the API that bundled features and plugins register through.
// Type-only, so importing it never initializes registries, settings, storage, or the runtime.
import type { Component } from 'svelte';
import type { ControlConfig, ControlFaceProps } from '../controls/model';
import type { AppletDef } from '../applets/contracts';
import type { Trigger } from '../automation/scenario';
import type { VariableDefinition, VariableRecord, VariableValue } from '../automation/variables';

/** A reference to an action plus its arguments, as stored in settings. */
export type ActionRef = { id: string; args?: Record<string, unknown> };

export type Option = {
  value: string;
  label: string;
  plugin?: string;
  detail?: string;
  /** A Lucide or app-pack icon name shown before the label. */
  iconName?: string;
  appKey?: string;
  unavailable?: boolean;
  /** The selected label is still being resolved. */
  loading?: boolean;
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
  /** Select only: the dropdown is searchable, for lists that can grow long. */
  searchable?: boolean;
  /** Offered values. A function is re-read each time the editor opens. */
  suggestions?: Option[] | ((args?: Record<string, unknown>) => Option[]);
  /** Text only: how a stored value reads in the field while no suggestion lists it. */
  describe?: (value: string) => Option | undefined;
  /** Reloads whatever `suggestions` reads; called when the dropdown opens. */
  refresh?: (args?: Record<string, unknown>) => Promise<unknown>;
  default?: unknown;
  /** Number only: a value outside [min, max] is rejected. */
  min?: number;
  max?: number;
  step?: number;
  /** Text only: lets the user add a value by hand. `browse` opens a picker and returns the value to use; `keep` remembers one that was typed. */
  manual?: { browse(): Promise<string | null>; keep(value: string): void };
  /** Hidden, not cleared, while false. Receives the current arguments or resolved settings. */
  visible?: (args: Record<string, unknown>) => boolean;
};

/** A titled group of settings. `id` anchors the local index and is never a storage key. */
export type SettingsGroup = { id: string; title: string; params: Param[] };

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
  /** The only scenario triggers it offers and runs; set, it also has no views or state bindings. */
  triggers?: readonly Trigger[];
  /** Starting configuration when added from the palette. */
  create(): Omit<ControlConfig, 'id' | 'type'>;
};

/** Where media commands go: Windows' current player, or a specific app supplied by a plugin. */
export type MediaSource = {
  plugin?: string;
  id: string;
  title: string;
  /** With `sessionId` the command goes to exactly that session of the linked status source. */
  command(
    command: 'prev' | 'next' | 'toggle' | 'play' | 'pause',
    sessionId?: string,
  ): Promise<unknown>;
};

export type NowPlayingTimeline = {
  /** Milliseconds. `sampledAtMs` is the UTC time `positionMs` was true at. */
  positionMs: number;
  startMs: number;
  endMs: number;
  /** Playback speed; absent when the app does not say. */
  rate?: number;
  sampledAtMs: number;
};

/** What a status source reports for one player session. Text only; the host renders it as text. */
export type NowPlayingSession = {
  /** Local to the provider; targets `MediaSource.command`. */
  sessionId: string;
  trackId?: string;
  title: string;
  artist: string;
  album: string;
  state: 'playing' | 'paused' | 'stopped' | 'unknown';
  /** Whether the player considers this its current session. */
  current: boolean;
  timeline?: NowPlayingTimeline;
  /** Handle issued by the native artwork cache; anything else is ignored. */
  artwork?: string;
};

export type NowPlayingSourceState =
  { state: 'ready'; sessions: readonly NowPlayingSession[] } | { state: 'unavailable' };

/** A read model: what a player is showing now. Transport stays with the linked `MediaSource`. */
export type StatusSourceDef = {
  plugin?: string;
  id: string;
  title: string;
  kind: 'nowPlaying';
  /** This plugin's media source that commands this source's sessions. */
  mediaSourceId?: string;
  /** Starts reporting; the returned function stops it. Nothing runs until a widget needs it. */
  subscribe(emit: (state: NowPlayingSourceState) => void, signal: AbortSignal): () => void;
};

export type PluginApi = {
  registerAction(def: ActionDef): void;
  registerValue(def: ValueDef): void;
  registerControl(def: ControlTypeDef): void;
  registerApplet(def: AppletDef): void;
  registerMediaSource(def: MediaSource): void;
  registerStatusSource(def: StatusSourceDef): void;
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
  /** Part of the app itself: not listed on the Plugins page. */
  builtin?: boolean;
  /** A section of the plugin page for settings that must stay out of settings.json, such as credentials. */
  settingsSection?: Component;
  setup(api: PluginApi): void;
};

import type { Component } from 'svelte';
import type { Readable } from 'svelte/store';
import type { ActionDef, ActionRef, EventDef, Param } from '../plugins/contracts';
import type { ControlConfig, ControlFaceProps } from '../controls/model';
import type { Page } from '../settings/schema';
import type { VariableType, VariableValue } from '../automation/variables';

export type SkinRect = { x: number; y: number; w: number; h: number };
export type SkinDesignFit = { scale: number; offsetX: number; offsetY: number };

export function fitSkinDesign(width: number, height: number, designWidth: number, designHeight: number): SkinDesignFit | null {
  if (![width, height, designWidth, designHeight].every(Number.isFinite) || width <= 0 || height <= 0 || designWidth <= 0 || designHeight <= 0)
    return null;
  const scale = Math.min(width / designWidth, height / designHeight);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return { scale, offsetX: (width - designWidth * scale) / 2, offsetY: (height - designHeight * scale) / 2 };
}

export function mapSkinPoint(clientX: number, clientY: number, hostLeft: number, hostTop: number,
  fit: SkinDesignFit, designWidth: number, designHeight: number) {
  const x = (clientX - hostLeft - fit.offsetX) / fit.scale;
  const y = (clientY - hostTop - fit.offsetY) / fit.scale;
  return x < 0 || y < 0 || x > designWidth || y > designHeight ? null : { x, y };
}

export type SkinGrid = 'page' | { rows: number; cols: number; size: number; gap: number; sizing: 'auto' | 'manual' };
export type SkinSlot = {
  id: string;
  style: 'region' | 'anchored';
  kind: 'grid' | 'strip';
  rect?: SkinRect;
  accepts?: string[];
  max?: number;
  size?: { w: number; h: number };
  grid: SkinGrid;
};
export type SkinView = { id: string; title: string; slots: string[] };
export type SkinStateField = {
  key: string;
  type: VariableType;
  initialValue: VariableValue;
  persistent?: boolean;
};
export type SkinPageNavigation = 'swipe' | 'skin';
export type SkinAlter = 'layout' | 'logic';
export type SkinConfig = Readonly<Record<string, unknown>>;
export type SkinRuntimeContext = {
  config: Readable<SkinConfig>;
  getState(key: string): VariableValue | undefined;
  setState(key: string, value: VariableValue, ancestry?: { depth: number; listeners: string[] }): Promise<boolean>;
  setView(viewId: string, ancestry?: { depth: number; listeners: string[] }): Promise<boolean>;
  emitEvent(id: string, parameter?: string, payload?: unknown, ancestry?: { depth: number; listeners: string[] }): Promise<void>;
};
export type SkinControlFace = {
  component: Component<ControlFaceProps>;
  sizes?: Record<string, { min: { w: number; h: number }; default: { w: number; h: number }; max?: { w: number; h: number } }>;
};

export type SkinDef = {
  plugin?: string;
  id: string;
  title: string;
  component: Component<{ page: Page }>;
  alters?: SkinAlter[];
  design?: { width: number; height: number };
  slots: SkinSlot[];
  views: SkinView[];
  defaultView: string;
  pageNavigation?: SkinPageNavigation;
  controlSkins?: Record<string, SkinControlFace>;
  settings?: Param[];
  quickActions?: ActionRef[];
  state?: SkinStateField[];
  events?: Omit<EventDef, 'plugin'>[];
  runtime?: (context: SkinRuntimeContext) => void | (() => void);
};

export function skinFaceFor(skin: SkinDef, typeId: string, defaultFace?: Component<ControlFaceProps>) {
  if (!defaultFace) return undefined;
  return skin.controlSkins?.[typeId]?.component ?? defaultFace;
}

export function validSkinStateValue(type: VariableType, value: unknown) {
  return type === 'boolean' ? typeof value === 'boolean'
    : type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value)
      : type === 'float' ? typeof value === 'number' && Number.isFinite(value)
        : typeof value === 'string';
}

export function validSkinParam(param: Param, value: unknown, args?: Record<string, unknown>) {
  if (param.type === 'boolean') return typeof value === 'boolean';
  if (param.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (param.type === 'actions') return Array.isArray(value) && value.every(step => !!step && typeof step === 'object' &&
    typeof (step as { id?: unknown }).id === 'string');
  if (typeof value !== 'string') return false;
  if (param.type !== 'select') return true;
  const options = typeof param.suggestions === 'function' ? param.suggestions(args) : param.suggestions;
  return options?.some(option => option.value === value) ?? false;
}

export function resolveQuickActions(refs: readonly ActionRef[] | undefined, available: ReadonlyMap<string, ActionDef>) {
  return (refs ?? []).map(ref => ({ ref, action: available.get(ref.id) }));
}

export function resolveSkinConfig(skin: SkinDef, stored: Record<string, unknown> = {}) {
  const config: Record<string, unknown> = { ...stored };
  for (const param of skin.settings ?? []) {
    const value = Object.hasOwn(stored, param.key) ? stored[param.key] : param.default;
    if (value !== undefined && validSkinParam(param, value)) config[param.key] = value;
    else if (param.default !== undefined && validSkinParam(param, param.default)) config[param.key] = param.default;
    else delete config[param.key];
  }
  return config;
}

export function validateSkinDefinition(def: SkinDef) {
  const id = def && typeof def.id === 'string' ? def.id : 'unknown';
  const fail = (message: string): never => { throw new Error(`Invalid skin "${id}": ${message}`); };
  if (!def || typeof def.id !== 'string' || !def.id.trim() || typeof def.title !== 'string' || !def.title.trim())
    fail('ID and title are required');
  if (def.design && (![def.design.width, def.design.height].every(Number.isFinite) || def.design.width <= 0 || def.design.height <= 0))
    fail('design dimensions must be finite and positive');
  if (!Array.isArray(def.slots) || !Array.isArray(def.views)) fail('slots and views are required');
  if (def.alters !== undefined && (!Array.isArray(def.alters) || new Set(def.alters).size !== def.alters.length ||
    def.alters.some(alter => alter !== 'layout' && alter !== 'logic'))) fail('alters must contain unique layout or logic values');
  if (def.pageNavigation !== undefined && def.pageNavigation !== 'swipe' && def.pageNavigation !== 'skin')
    fail('pageNavigation must be "swipe" or "skin"');
  const slots = new Map<string, SkinSlot>();
  for (const slot of def.slots ?? []) {
    if (!slot || typeof slot.id !== 'string' || !slot.id.trim() || slots.has(slot.id)) fail('slot IDs must be unique and nonempty');
    if (!['region', 'anchored'].includes(slot.style) || !['grid', 'strip'].includes(slot.kind))
      fail(`slot "${slot.id}" has invalid style or kind`);
    if (slot.rect && (![slot.rect.x, slot.rect.y, slot.rect.w, slot.rect.h].every(Number.isFinite) || slot.rect.w <= 0 || slot.rect.h <= 0))
      fail(`slot "${slot.id}" has invalid geometry`);
    if (slot.max !== undefined && (!Number.isSafeInteger(slot.max) || slot.max <= 0)) fail(`slot "${slot.id}" has invalid max`);
    if (slot.size && (![slot.size.w, slot.size.h].every(Number.isSafeInteger) || slot.size.w <= 0 || slot.size.h <= 0))
      fail(`slot "${slot.id}" has invalid fixed size`);
    if (slot.accepts !== undefined && (!Array.isArray(slot.accepts) || slot.accepts.some(type => typeof type !== 'string' || !type.trim())))
      fail(`slot "${slot.id}" has invalid accepted types`);
    if (slot.grid !== 'page' && (!slot.grid || typeof slot.grid !== 'object' || !Number.isSafeInteger(slot.grid.rows) || slot.grid.rows <= 0 ||
      !Number.isSafeInteger(slot.grid.cols) || slot.grid.cols <= 0 || !Number.isFinite(slot.grid.size) || slot.grid.size <= 0 ||
      !Number.isFinite(slot.grid.gap) || slot.grid.gap < 0 || !['auto', 'manual'].includes(slot.grid.sizing)))
      fail(`slot "${slot.id}" has invalid grid`);
    slots.set(slot.id, slot);
  }
  const views = new Set<string>();
  for (const view of def.views ?? []) {
    if (!view || typeof view.id !== 'string' || !view.id.trim() || views.has(view.id)) fail('view IDs must be unique and nonempty');
    if (typeof view.title !== 'string' || !view.title.trim() || !Array.isArray(view.slots) ||
      new Set(view.slots).size !== view.slots.length || view.slots.some(id => !slots.has(id)))
      fail(`view "${view.id}" has invalid slot references`);
    views.add(view.id);
  }
  if (!views.has(def.defaultView)) fail('defaultView must name a registered view');
  const fields = new Set<string>();
  for (const field of def.state ?? []) {
    if (!field || typeof field.key !== 'string' || !/^[a-zA-Z][\w-]*$/.test(field.key) || field.key === 'view' || fields.has(field.key))
      fail('state keys must be unique namespaced fields');
    if (!['boolean', 'integer', 'float', 'string'].includes(field.type) || !validSkinStateValue(field.type, field.initialValue))
      fail(`state field "${field.key}" has an invalid value`);
    if (field.persistent !== undefined && typeof field.persistent !== 'boolean') fail(`state field "${field.key}" has invalid persistence`);
    fields.add(field.key);
  }
  const events = new Set<string>();
  for (const event of def.events ?? []) {
    if (!event || typeof event.id !== 'string' || !event.id.startsWith(`${def.id}.`) || event.id.length <= def.id.length + 1 ||
      events.has(event.id) || typeof event.title !== 'string' || !event.title.trim()) fail('events must have unique skin-prefixed IDs and titles');
    events.add(event.id);
  }
}

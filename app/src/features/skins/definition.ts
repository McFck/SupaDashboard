import type { Param } from '../plugins/contracts';
import type { VariableType } from '../automation/variables';
import type { SkinDef } from './contracts';

export function validSkinStateValue(type: VariableType, value: unknown) {
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'float':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeof value === 'string';
  }
}

export type { SkinDef, SkinRuntimeContext, SkinStateField } from './contracts';

export function validSkinParam(param: Param, value: unknown, args?: Record<string, unknown>) {
  if (param.type === 'boolean') {
    return typeof value === 'boolean';
  }
  if (param.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (typeof value !== 'string') {
    return false;
  }
  if (param.type !== 'select') {
    return true;
  }
  const options =
    typeof param.suggestions === 'function' ? param.suggestions(args) : param.suggestions;
  return options?.some((option) => option.value === value) ?? false;
}

export function resolveSkinConfig(skin: SkinDef, stored: Record<string, unknown> = {}) {
  const config: Record<string, unknown> = { ...stored };
  for (const param of skin.settings ?? []) {
    const value = Object.hasOwn(stored, param.key) ? stored[param.key] : param.default;
    if (value !== undefined && validSkinParam(param, value)) {
      config[param.key] = value;
    } else if (param.default !== undefined && validSkinParam(param, param.default)) {
      config[param.key] = param.default;
    } else {
      delete config[param.key];
    }
  }
  return config;
}

/** Skins are bundled with the app, so this catches developer mistakes; the types cover the rest. */
export function validateSkinDefinition(def: SkinDef) {
  const fail = (message: string): never => {
    throw new Error(`Invalid skin "${def.id}": ${message}`);
  };
  const positive = (...values: number[]) => values.every((v) => Number.isFinite(v) && v > 0);
  const positiveInt = (...values: number[]) =>
    values.every((v) => Number.isSafeInteger(v) && v > 0);
  if (def.design && !positive(def.design.width, def.design.height)) {
    fail('design dimensions must be finite and positive');
  }
  const slots = new Set<string>();
  for (const slot of def.slots) {
    if (!slot.id.trim() || slots.has(slot.id)) {
      fail('slot IDs must be unique and nonempty');
    }
    const { rect, size, grid } = slot;
    if (rect && (![rect.x, rect.y].every(Number.isFinite) || !positive(rect.w, rect.h))) {
      fail(`slot "${slot.id}" has invalid geometry`);
    }
    if (slot.max !== undefined && !positiveInt(slot.max)) {
      fail(`slot "${slot.id}" has invalid max`);
    }
    if (size && !positiveInt(size.w, size.h)) {
      fail(`slot "${slot.id}" has invalid fixed size`);
    }
    if (
      grid !== 'page' &&
      (!positiveInt(grid.rows, grid.cols) || !positive(grid.size) || !(grid.gap >= 0))
    ) {
      fail(`slot "${slot.id}" has invalid grid`);
    }
    slots.add(slot.id);
  }
  const views = new Set<string>();
  for (const view of def.views) {
    if (!view.id.trim() || views.has(view.id)) {
      fail('view IDs must be unique and nonempty');
    }
    if (
      !view.title.trim() ||
      new Set(view.slots).size !== view.slots.length ||
      view.slots.some((id) => !slots.has(id))
    ) {
      fail(`view "${view.id}" has invalid slot references`);
    }
    views.add(view.id);
  }
  if (!views.has(def.defaultView)) {
    fail('defaultView must name a registered view');
  }
  const fields = new Set<string>();
  for (const field of def.state ?? []) {
    if (!/^[a-zA-Z][\w-]*$/.test(field.key) || field.key === 'view' || fields.has(field.key)) {
      fail('state keys must be unique namespaced fields');
    }
    if (!validSkinStateValue(field.type, field.initialValue)) {
      fail(`state field "${field.key}" has an invalid value`);
    }
    fields.add(field.key);
  }
  const events = new Set<string>();
  for (const event of def.events ?? []) {
    if (
      !event.id.startsWith(`${def.id}.`) ||
      event.id.length <= def.id.length + 1 ||
      events.has(event.id) ||
      !event.title.trim()
    ) {
      fail('events must have unique skin-prefixed IDs and titles');
    }
    events.add(event.id);
  }
}

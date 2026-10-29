import type { Param, SettingsGroup } from '../plugins/contracts';
import type { VariableType } from '../automation/variables';
import type { AppletDef } from './contracts';

type AppletSettings = NonNullable<AppletDef['settings']>;

const isGroup = (item: Param | SettingsGroup): item is SettingsGroup => 'params' in item;

const optionsOf = (param: Param, args?: Record<string, unknown>) =>
  typeof param.suggestions === 'function' ? param.suggestions(args) : param.suggestions;

const QUICK_ACTION_GROUP: SettingsGroup = {
  id: 'quick-actions',
  title: 'Quick actions',
  params: [
    {
      key: 'gesture',
      label: 'Gesture',
      type: 'select',
      default: 'tripleTap',
      suggestions: [
        { value: 'tripleTap', label: 'Triple tap' },
        { value: 'cornerHold', label: 'Corner hold' },
        { value: 'off', label: 'Off' },
      ],
    },
    {
      key: 'corner',
      label: 'Corner',
      visible: (values) => values.gesture === 'cornerHold',
      type: 'select',
      default: 'bottomRight',
      suggestions: [
        { value: 'topLeft', label: 'Top left' },
        { value: 'topRight', label: 'Top right' },
        { value: 'bottomLeft', label: 'Bottom left' },
        { value: 'bottomRight', label: 'Bottom right' },
      ],
    },
  ],
};
const QUICK_ACTION_KEYS = QUICK_ACTION_GROUP.params.map((param) => param.key);

/** The host owns the quick-action gesture, so applets with quick actions get its group appended. */
export function withQuickActionSettings(applet: AppletDef): AppletDef {
  if (!applet.quickActions?.length) {
    return applet;
  }
  return { ...applet, settings: [...(applet.settings ?? []), QUICK_ACTION_GROUP] };
}

/** Every param in declaration order, whether declared loose or inside a group. */
export function settingParams(settings: AppletSettings = []): Param[] {
  return settings.flatMap((item) => (isGroup(item) ? item.params : [item]));
}

/** Loose params share one General group, placed at the first loose param. */
export function settingGroups(settings: AppletSettings = []): SettingsGroup[] {
  const groups: SettingsGroup[] = [];
  let general: SettingsGroup | undefined;
  for (const item of settings) {
    if (isGroup(item)) {
      groups.push(item);
    } else {
      if (!general) {
        general = { id: 'general', title: 'General', params: [] };
        groups.push(general);
      }
      general.params.push(item);
    }
  }
  return groups;
}

export function validAppletStateValue(type: VariableType, value: unknown) {
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

export function validAppletParam(param: Param, value: unknown, args?: Record<string, unknown>) {
  if (param.type === 'boolean') {
    return typeof value === 'boolean';
  }
  if (param.type === 'number') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (param.min === undefined || value >= param.min) &&
      (param.max === undefined || value <= param.max)
    );
  }
  if (typeof value !== 'string') {
    return false;
  }
  if (param.type !== 'select') {
    return true;
  }
  return optionsOf(param, args)?.some((option) => option.value === value) ?? false;
}

export function resolveAppletConfig(applet: AppletDef, stored: Record<string, unknown> = {}) {
  const config: Record<string, unknown> = { ...stored };
  for (const param of settingParams(applet.settings)) {
    const value = Object.hasOwn(stored, param.key) ? stored[param.key] : param.default;
    if (value !== undefined && validAppletParam(param, value)) {
      config[param.key] = value;
    } else if (param.default !== undefined && validAppletParam(param, param.default)) {
      config[param.key] = param.default;
    } else {
      delete config[param.key];
    }
  }
  return config;
}

/**
 * The stored settings after one change, or null when nothing changes. Settings whose value the change
 * invalidates (a select whose options depend on another setting) fall back to their default or first option.
 */
export function nextAppletSettings(
  applet: AppletDef,
  stored: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> | null {
  const params = settingParams(applet.settings);
  const param = params.find((item) => item.key === key);
  const previous = resolveAppletConfig(applet, stored);
  if (!param || !validAppletParam(param, value, previous)) {
    return null;
  }
  const next = { ...stored, [key]: value };
  const resolved = { ...previous, [key]: value };
  for (const dependent of params) {
    if (dependent.key === key || validAppletParam(dependent, resolved[dependent.key], resolved)) {
      continue;
    }
    const options = optionsOf(dependent, resolved);
    const fallback =
      options?.find((option) => Object.is(option.value, dependent.default))?.value ??
      options?.[0]?.value;
    if (fallback === undefined) {
      delete next[dependent.key];
      delete resolved[dependent.key];
    } else {
      next[dependent.key] = fallback;
      resolved[dependent.key] = fallback;
    }
  }
  const unchanged =
    Object.keys(next).every((k) => Object.is(next[k], stored[k])) &&
    Object.keys(stored).every((k) => Object.is(stored[k], next[k]));
  return unchanged ? null : next;
}

/** Applets are bundled with the app, so this catches developer mistakes; the types cover the rest. */
export function validateAppletDefinition(def: AppletDef) {
  const fail = (message: string): never => {
    throw new Error(`Invalid applet "${def.id}": ${message}`);
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
    const { size, grid } = slot;
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
    if (!validAppletStateValue(field.type, field.initialValue)) {
      fail(`state field "${field.key}" has an invalid value`);
    }
    fields.add(field.key);
  }
  const groupIds = new Set<string>();
  const paramKeys = new Set<string>();
  for (const group of settingGroups(def.settings)) {
    if (!group.id.trim() || groupIds.has(group.id)) {
      fail('settings group IDs must be unique and nonempty');
    }
    groupIds.add(group.id);
  }
  for (const param of settingParams(def.settings)) {
    if (QUICK_ACTION_KEYS.includes(param.key)) {
      fail(`setting "${param.key}" is reserved by the host`);
    }
    if (paramKeys.has(param.key)) {
      fail(`duplicate setting "${param.key}"`);
    }
    if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
      fail(`setting "${param.key}" has min above max`);
    }
    paramKeys.add(param.key);
  }
  const events = new Set<string>();
  for (const event of def.events ?? []) {
    if (
      !event.id.startsWith(`${def.id}.`) ||
      event.id.length <= def.id.length + 1 ||
      events.has(event.id) ||
      !event.title.trim()
    ) {
      fail('events must have unique applet-prefixed IDs and titles');
    }
    events.add(event.id);
  }
}

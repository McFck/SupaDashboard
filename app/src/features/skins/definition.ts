import type { ActionDef, ActionRef, Param } from '../plugins/contracts';
import type { VariableType } from '../automation/variables';
import type { SkinDef, SkinSlot } from './contracts';

export function validSkinStateValue(type: VariableType, value: unknown) {
  return type === 'boolean'
    ? typeof value === 'boolean'
    : type === 'integer'
      ? typeof value === 'number' && Number.isSafeInteger(value)
      : type === 'float'
        ? typeof value === 'number' && Number.isFinite(value)
        : typeof value === 'string';
}

export type { SkinDef, SkinRuntimeContext, SkinStateField } from './contracts';

export function validSkinParam(param: Param, value: unknown, args?: Record<string, unknown>) {
  if (param.type === 'boolean') return typeof value === 'boolean';
  if (param.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (param.type === 'actions')
    return (
      Array.isArray(value) &&
      value.every(
        (step) =>
          !!step && typeof step === 'object' && typeof (step as { id?: unknown }).id === 'string',
      )
    );
  if (typeof value !== 'string') return false;
  if (param.type !== 'select') return true;
  const options =
    typeof param.suggestions === 'function' ? param.suggestions(args) : param.suggestions;
  return options?.some((option) => option.value === value) ?? false;
}

export function resolveQuickActions(
  refs: readonly ActionRef[] | undefined,
  available: ReadonlyMap<string, ActionDef>,
) {
  return (refs ?? []).map((ref) => ({ ref, action: available.get(ref.id) }));
}

export function resolveSkinConfig(skin: SkinDef, stored: Record<string, unknown> = {}) {
  const config: Record<string, unknown> = { ...stored };
  for (const param of skin.settings ?? []) {
    const value = Object.hasOwn(stored, param.key) ? stored[param.key] : param.default;
    if (value !== undefined && validSkinParam(param, value)) config[param.key] = value;
    else if (param.default !== undefined && validSkinParam(param, param.default))
      config[param.key] = param.default;
    else delete config[param.key];
  }
  return config;
}

export function validateSkinDefinition(def: SkinDef) {
  const id = def && typeof def.id === 'string' ? def.id : 'unknown';
  const fail = (message: string): never => {
    throw new Error(`Invalid skin "${id}": ${message}`);
  };
  if (
    !def ||
    typeof def.id !== 'string' ||
    !def.id.trim() ||
    typeof def.title !== 'string' ||
    !def.title.trim()
  )
    fail('ID and title are required');
  if (
    def.design &&
    (![def.design.width, def.design.height].every(Number.isFinite) ||
      def.design.width <= 0 ||
      def.design.height <= 0)
  )
    fail('design dimensions must be finite and positive');
  if (!Array.isArray(def.slots) || !Array.isArray(def.views)) fail('slots and views are required');
  if (
    def.alters !== undefined &&
    (!Array.isArray(def.alters) ||
      new Set(def.alters).size !== def.alters.length ||
      def.alters.some((alter) => alter !== 'layout' && alter !== 'logic'))
  )
    fail('alters must contain unique layout or logic values');
  if (
    def.pageNavigation !== undefined &&
    def.pageNavigation !== 'swipe' &&
    def.pageNavigation !== 'skin'
  )
    fail('pageNavigation must be "swipe" or "skin"');
  const slots = new Map<string, SkinSlot>();
  for (const slot of def.slots ?? []) {
    if (!slot || typeof slot.id !== 'string' || !slot.id.trim() || slots.has(slot.id))
      fail('slot IDs must be unique and nonempty');
    if (!['region', 'anchored'].includes(slot.style) || !['grid', 'strip'].includes(slot.kind))
      fail(`slot "${slot.id}" has invalid style or kind`);
    if (
      slot.rect &&
      (![slot.rect.x, slot.rect.y, slot.rect.w, slot.rect.h].every(Number.isFinite) ||
        slot.rect.w <= 0 ||
        slot.rect.h <= 0)
    )
      fail(`slot "${slot.id}" has invalid geometry`);
    if (slot.max !== undefined && (!Number.isSafeInteger(slot.max) || slot.max <= 0))
      fail(`slot "${slot.id}" has invalid max`);
    if (
      slot.size &&
      (![slot.size.w, slot.size.h].every(Number.isSafeInteger) ||
        slot.size.w <= 0 ||
        slot.size.h <= 0)
    )
      fail(`slot "${slot.id}" has invalid fixed size`);
    if (
      slot.accepts !== undefined &&
      (!Array.isArray(slot.accepts) ||
        slot.accepts.some((type) => typeof type !== 'string' || !type.trim()))
    )
      fail(`slot "${slot.id}" has invalid accepted types`);
    if (
      slot.grid !== 'page' &&
      (!slot.grid ||
        typeof slot.grid !== 'object' ||
        !Number.isSafeInteger(slot.grid.rows) ||
        slot.grid.rows <= 0 ||
        !Number.isSafeInteger(slot.grid.cols) ||
        slot.grid.cols <= 0 ||
        !Number.isFinite(slot.grid.size) ||
        slot.grid.size <= 0 ||
        !Number.isFinite(slot.grid.gap) ||
        slot.grid.gap < 0 ||
        !['auto', 'manual'].includes(slot.grid.sizing))
    )
      fail(`slot "${slot.id}" has invalid grid`);
    slots.set(slot.id, slot);
  }
  const views = new Set<string>();
  for (const view of def.views ?? []) {
    if (!view || typeof view.id !== 'string' || !view.id.trim() || views.has(view.id))
      fail('view IDs must be unique and nonempty');
    if (
      typeof view.title !== 'string' ||
      !view.title.trim() ||
      !Array.isArray(view.slots) ||
      new Set(view.slots).size !== view.slots.length ||
      view.slots.some((id) => !slots.has(id))
    )
      fail(`view "${view.id}" has invalid slot references`);
    views.add(view.id);
  }
  if (!views.has(def.defaultView)) fail('defaultView must name a registered view');
  const fields = new Set<string>();
  for (const field of def.state ?? []) {
    if (
      !field ||
      typeof field.key !== 'string' ||
      !/^[a-zA-Z][\w-]*$/.test(field.key) ||
      field.key === 'view' ||
      fields.has(field.key)
    )
      fail('state keys must be unique namespaced fields');
    if (
      !['boolean', 'integer', 'float', 'string'].includes(field.type) ||
      !validSkinStateValue(field.type, field.initialValue)
    )
      fail(`state field "${field.key}" has an invalid value`);
    if (field.persistent !== undefined && typeof field.persistent !== 'boolean')
      fail(`state field "${field.key}" has invalid persistence`);
    fields.add(field.key);
  }
  const events = new Set<string>();
  for (const event of def.events ?? []) {
    if (
      !event ||
      typeof event.id !== 'string' ||
      !event.id.startsWith(`${def.id}.`) ||
      event.id.length <= def.id.length + 1 ||
      events.has(event.id) ||
      typeof event.title !== 'string' ||
      !event.title.trim()
    )
      fail('events must have unique skin-prefixed IDs and titles');
    events.add(event.id);
  }
}

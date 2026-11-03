import { firstFree, type Item } from '../layout/grid';
import { DEFAULT_PAGE } from './defaults';
import { isRecord } from '../automation/plain-data';
import { normalizeControl } from '../automation/normalize-control';
import { actionRef, walkSteps } from '../automation/scenario';
import { TILE_STYLES } from '../controls/model';
import { appVariable, isAppKey, parseAppVariable, windowState } from '../apps/keys';

export function object(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error('Settings contain a malformed object');
  }
  return value;
}

export function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function savedControls(raw: unknown): (Record<string, unknown> & {
  id: string;
  name: string;
  type: string;
  variants: Record<string, unknown>[];
  gestures: Record<string, unknown>;
})[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error('Settings controls must be an array');
  }
  return raw.map((value: unknown) => {
    const control = object(value);
    if (typeof control.id !== 'string' || !control.id || typeof control.type !== 'string') {
      throw new Error('Settings contain a malformed control');
    }
    if (control.name !== undefined && typeof control.name !== 'string') {
      throw new Error('Control name must be text');
    }
    if (control.variants !== undefined && !Array.isArray(control.variants)) {
      throw new Error('Control variants must be an array');
    }
    if (control.options !== undefined) {
      object(control.options);
    }
    // v12: the single `stateBinding` became the `stateBindings` list.
    const { stateBinding, ...current } = control;
    const saved = current.stateBindings ?? stateBinding;
    const bindings: unknown[] = saved == null ? [] : Array.isArray(saved) ? saved : [saved];
    if (stateBinding == null && saved != null && !Array.isArray(saved)) {
      throw new Error('Control state bindings must be an array');
    }
    for (const entry of bindings) {
      const binding = object(entry);
      if (
        typeof binding.variableId !== 'string' ||
        !Array.isArray(binding.cases) ||
        !binding.cases.every(
          (item: unknown) =>
            isRecord(item) &&
            typeof item.stateId === 'string' &&
            (typeof item.value === 'string' ||
              typeof item.value === 'boolean' ||
              (typeof item.value === 'number' && Number.isFinite(item.value))),
        )
      ) {
        throw new Error('Settings contain a malformed state binding');
      }
    }
    const variants: Record<string, unknown>[] = (control.variants ?? []).map((variant: unknown) => {
      if (
        !isRecord(variant) ||
        (variant.label !== undefined && typeof variant.label !== 'string')
      ) {
        throw new Error('Settings contain a malformed variant');
      }
      for (const field of ['icon', 'color', 'background']) {
        if (variant[field] != null && typeof variant[field] !== 'string') {
          throw new Error(`Variant ${field} must be text`);
        }
      }
      if (variant.style !== undefined && !TILE_STYLES.some((style) => style === variant.style)) {
        throw new Error('Variant style is unknown');
      }
      if (variant.app !== undefined && !isAppKey(variant.app)) {
        throw new Error('Variant app is invalid');
      }
      return { ...variant, label: variant.label ?? '' };
    });
    return {
      ...current,
      ...(bindings.length ? { stateBindings: bindings } : {}),
      id: control.id,
      name: control.name ?? control.id,
      type: control.type,
      variants,
      gestures: object(control.gestures),
    };
  });
}

export function upgrade(input: Record<string, unknown>) {
  let saved = structuredClone(input);
  if (typeof saved.version === 'number' && saved.version > 17) {
    throw new Error(`Settings version ${saved.version} is newer than this app supports`);
  }
  const rawControls = savedControls(saved.controls);
  if (saved.version === 1) {
    const icon: Record<string, string> = {
      prev: 'SkipBack',
      next: 'SkipForward',
      playpause: 'Play',
      volume: 'Volume2',
    };
    for (const c of rawControls) {
      for (const v of c.variants) {
        if (typeof v.icon === 'string') {
          v.icon = icon[v.icon] ?? v.icon;
        }
      }
    }
    saved = {
      ...saved,
      version: 2,
      skin: saved.skin === 'classic' ? 'deck' : saved.skin,
      deck: null,
    };
  }
  if (saved.version === 2) {
    // Media targets became plugin-provided sources; Spotify's app link became the Spotify plugin's action.
    const fix = (value: unknown) => {
      if (value === undefined || value === null) {
        return;
      }
      const a = object(value);
      const args = object(a.args);
      if (typeof a.id === 'string' && a.id.startsWith('media.')) {
        a.args = { source: args.target === 'spotify' ? 'spotify' : 'system' };
      }
      if (a.id === 'open' && typeof args.url === 'string' && args.url.startsWith('spotify:')) {
        a.id = 'spotify.open';
        delete a.args;
      }
      if (args.steps !== undefined && !Array.isArray(args.steps)) {
        throw new Error('Sequence steps must be an array');
      }
      for (const s of args.steps ?? []) {
        fix(s);
      }
    };
    for (const c of rawControls) {
      for (const v of c.variants) {
        fix(v.action);
      }
      for (const g of Object.values(c.gestures)) {
        fix(g);
      }
    }
    const old = object(saved.deck);
    if (
      old.cells !== undefined &&
      (!Array.isArray(old.cells) ||
        !old.cells.every((cell: unknown) => typeof cell === 'string' || cell === null))
    ) {
      throw new Error('Legacy deck cells must be an array of control IDs');
    }
    const cols = positiveInteger(old.cols) ? old.cols : DEFAULT_PAGE.cols;
    const items: Item[] = Array.isArray(old.cells)
      ? old.cells.flatMap((control: string | null, i: number) =>
          control
            ? [{ id: `i${i}`, control, x: i % cols, y: Math.floor(i / cols), w: 1, h: 1 }]
            : [],
        )
      : structuredClone(DEFAULT_PAGE.items);
    saved = {
      ...saved,
      version: 3,
      deck: Array.isArray(old.cells)
        ? { rows: old.rows, cols: old.cols, size: old.size, gap: old.gap, items }
        : { ...structuredClone(DEFAULT_PAGE), items },
    };
  }
  // v6 was briefly emitted by a development build with the v5 shape; v7 adds the nowPlaying `sources` option.
  if (![3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].includes(saved.version as number)) {
    throw new Error(`Unsupported settings version ${saved.version}`);
  } // never let an unknown file fall back to defaults and get saved over
  if (![8, 9, 10, 11, 12, 13, 14, 15, 16, 17].includes(saved.version as number)) {
    saved = toV8(saved);
  }
  if (saved.version === 8) {
    // Keep the old GDI choice until the user selects a monitor with native metadata.
    saved = { ...saved, version: 9, display: { ...object(saved.display), monitorLabel: null } };
  }
  if (saved.version === 9) {
    saved = { ...saved, version: 10, appletLayouts: mergeSubwaySide(object(saved.appletLayouts)) };
  }
  if (saved.version === 10) {
    saved = { ...saved, version: 11, apps: [] };
  }
  if (saved.version === 11) {
    saved = { ...saved, version: 12 };
  }
  if (saved.version === 12) {
    // v13: cover legacy actions, nested branches, event lists and per-state triggers alike.
    for (const control of rawControls) {
      const { scenario } = normalizeControl(control);
      if (!scenario) {
        continue;
      }
      walkSteps(scenario, (step) => {
        if (
          step.kind === 'action' &&
          actionRef(step.action) &&
          ['app.toggle', 'app.focus', 'app.minimize'].includes(step.action.id)
        ) {
          step.action.args = { windows: 'all', title: '', ...object(step.action.args) };
        }
      });
      control.scenario = scenario;
    }
    saved = { ...saved, version: 13 };
  }
  if (saved.version === 13) {
    // v14 gives window-state conditions and bindings an explicit Main window default.
    const scoped = (id: string) => {
      const parsed = parseAppVariable(id);
      return parsed && windowState(parsed.field) && !parsed.selection
        ? appVariable(parsed.slug, parsed.field, { windows: 'main', title: '' })
        : id;
    };
    for (const control of rawControls) {
      if (Array.isArray(control.stateBindings)) {
        for (const value of control.stateBindings) {
          const binding = object(value);
          if (typeof binding.variableId === 'string') {
            binding.variableId = scoped(binding.variableId);
          }
        }
      }
      const { scenario } = normalizeControl(control);
      if (scenario) {
        walkSteps(scenario, (step) => {
          if (step.kind === 'if' && step.condition.kind === 'compare') {
            for (const operand of [step.condition.left, step.condition.right]) {
              if (operand.kind === 'variable') {
                operand.id = scoped(operand.id);
              }
            }
          }
        });
        control.scenario = scenario;
      }
    }
    saved = { ...saved, version: 14 };
  }
  if (saved.version === 14) {
    // v15: canonical tile effects, with one owner across every branch and state of a trigger.
    for (const control of rawControls) {
      control.scenario = normalizeControl(control).scenario;
    }
    saved = { ...saved, version: 15 };
  }
  if (saved.version === 15) {
    // v16: states gained an optional face style; states without one keep the default face.
    saved = { ...saved, version: 16 };
  }
  const display = object(saved.display);
  if (saved.version === 16) {
    // v17: app faces may name an app key; old icon names remain valid fallbacks.
    saved = { ...saved, version: 17 };
  }
  if (display.monitorLabel != null && typeof display.monitorLabel !== 'string') {
    throw new Error('Monitor label must be text');
  }

  return { saved, rawControls };
}

/** v8: the global `skin` became `Page.applet`, and applet settings gained a shared/per-page scope. */
function toV8(saved: Record<string, unknown>) {
  const { skin, skinSettings, skinLayouts, ...rest } = saved;
  if (skin !== undefined && typeof skin !== 'string') {
    throw new Error('Settings contain a malformed skin');
  }
  const deck = object(rest.deck);
  if (skin && skin !== 'deck') {
    // Legacy single-page decks (v3, v4) have no pages yet; normalizeLayout copies their fields into page 1.
    if (Array.isArray(deck.pages)) {
      deck.pages = deck.pages.map((page: unknown) =>
        isRecord(page) ? { ...page, applet: skin } : page,
      );
    } else {
      deck.applet = skin;
    }
  }
  const appletSettings = Object.fromEntries(
    Object.entries(object(skinSettings))
      .filter(([id, values]) => !!id && isRecord(values))
      .map(([id, values]) => [id, { shared: values, separate: false }]),
  );
  return { ...rest, version: 8, deck, appletSettings, appletLayouts: object(skinLayouts) };
}

/**
 * v10: Subway's Run view lost its side slot; its controls move into the strip, which gained the two columns
 * the side slot held, so every one of them finds a free cell.
 */
function mergeSubwaySide(layouts: Record<string, unknown>) {
  const pages = object(layouts.subway);
  const merged = Object.fromEntries(
    Object.entries(pages).map(([pageId, value]) => {
      if (!isRecord(value)) {
        return [pageId, value];
      }
      const { side, ...slots } = value;
      if (!Array.isArray(side)) {
        return [pageId, slots];
      }
      const strip: Item[] = Array.isArray(slots.strip) ? [...slots.strip] : [];
      for (const item of side) {
        const cell = firstFree(strip, 1, 1, { rows: 1, cols: 10 });
        // Malformed placements are dropped by normalizeItems either way.
        if (
          cell &&
          isRecord(item) &&
          typeof item.id === 'string' &&
          typeof item.control === 'string'
        ) {
          strip.push({ id: item.id, control: item.control, ...cell, w: 1, h: 1 });
        }
      }
      return [pageId, { ...slots, strip }];
    }),
  );
  return isRecord(layouts.subway) ? { ...layouts, subway: merged } : layouts;
}

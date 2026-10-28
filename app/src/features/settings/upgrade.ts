import type { Item } from '../layout/grid';
import { DEFAULT_PAGE } from './defaults';
import { object, positiveInteger } from './validation';
import { savedControls } from './saved-controls';

export function upgrade(input: Record<string, unknown>) {
  let saved = structuredClone(input);
  if (typeof saved.version === 'number' && saved.version > 6) {
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
  // v6 was briefly emitted by a development build with this same settings shape; normalize it back to v5.
  if (saved.version !== 3 && saved.version !== 4 && saved.version !== 5 && saved.version !== 6) {
    throw new Error(`Unsupported settings version ${saved.version}`);
  } // never let an unknown file fall back to defaults and get saved over

  return { saved, rawControls };
}

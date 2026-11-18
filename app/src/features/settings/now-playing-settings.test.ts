import { describe, expect, it } from 'vitest';
import { serializeSettings } from './state.svelte';
import { DEFAULTS } from './defaults';
import { migrate } from './normalize';

describe('now playing options', () => {
  const withWidget = (version: number, options?: unknown) => ({
    ...structuredClone(DEFAULTS),
    version,
    controls: [
      ...structuredClone(DEFAULTS.controls),
      {
        id: 'np',
        name: 'Now playing',
        type: 'nowPlaying',
        variants: [{ id: 'state-1', label: '' }],
        ...(options === undefined ? {} : { options }),
      },
    ],
  });
  const widget = (settings: ReturnType<typeof migrate>) =>
    settings.controls.find((control) => control.id === 'np');

  it('upgrades v6 keeping every setting and giving the widget the All filter', () => {
    const v6 = withWidget(6);
    const migrated = migrate(v6);
    expect(migrated.version).toBe(21);
    expect(widget(migrated)?.options).toEqual({ sources: [] });
    expect({ ...migrated, version: 6, controls: migrated.controls.slice(0, -1) }).toEqual({
      ...v6,
      controls: v6.controls.slice(0, -1),
    });
    expect(migrate(JSON.parse(serializeSettings(migrated)))).toEqual(migrated);
  });

  it('keeps an explicit filter, including sources of apps that are not running', () => {
    const sources = ['spotify', 'app:Gone.App!Main'];
    const migrated = migrate(withWidget(7, { sources: [...sources, 'spotify'] }));
    expect(widget(migrated)?.options).toEqual({ sources });
  });

  it.each([{ sources: 'spotify' }, { sources: [1] }, { sources: [''] }, { sources: [null] }])(
    'refuses a malformed filter instead of widening it to All: %j',
    (options) => {
      expect(() => migrate(withWidget(7, options))).toThrow('Now playing sources are malformed');
    },
  );
});

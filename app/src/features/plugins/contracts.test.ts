import { expect, it } from 'vitest';
import fixture from './browser-actions.fixture.json';
import type { PluginBrowserAction } from './contracts';

type Kind = PluginBrowserAction['kind'];
type Input<K extends 'page' | 'media' | 'pointer'> = Extract<
  PluginBrowserAction,
  { kind: K }
>['input'];
type Examples<K extends 'page' | 'media' | 'pointer'> = Record<Input<K>['kind'], Input<K>>;

it('keeps an action fixture for every browser command in the kit', () => {
  const selection = {
    tab: 1,
    doc: '00000000000000000000000000000000',
    seq: 1,
    target: 1,
    x: 2,
    y: 3,
    token: '00000000000000000000000000000001',
  };
  const page = {
    top: { kind: 'top' },
    bottom: { kind: 'bottom' },
    page_up: { kind: 'page_up' },
    page_down: { kind: 'page_down' },
    preview: { kind: 'preview', selection },
    clear_preview: { kind: 'clear_preview', selection },
    press: { kind: 'press', selection, background: false },
  } satisfies Examples<'page'>;
  const media = {
    toggle: { kind: 'toggle' },
    seek: { kind: 'seek', seconds: -10 },
    speed: { kind: 'speed', rate: 1.5 },
    fullscreen: { kind: 'fullscreen' },
  } satisfies Examples<'media'>;
  const pointer = {
    begin: { kind: 'begin' },
    move: { kind: 'move', dx: 12, dy: -8 },
    click: { kind: 'click' },
    down: { kind: 'down' },
    up: { kind: 'up' },
    cancel: { kind: 'cancel' },
  } satisfies Examples<'pointer'>;
  // TypeScript widens string literals in JSON imports, so check the fixture against typed examples.
  const examples = {
    activate: [{ kind: 'activate', tab: 1 }],
    close: [{ kind: 'close', tab: 1 }],
    open: [{ kind: 'open', url: 'https://example.org/', destination: 'new' }],
    pointer: Object.values(pointer).map((input) => ({ kind: 'pointer', tab: 1, input })),
    page: Object.values(page).map((input) => ({ kind: 'page', input })),
    media: Object.values(media).map((input) => ({ kind: 'media', input })),
  } satisfies Record<Kind, PluginBrowserAction[]>;
  expect(fixture).toEqual(Object.values(examples).flat());
});

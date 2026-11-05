import { describe, expect, it } from 'vitest';
import { VariableStore } from '../automation/variables';
import { normalizeControl } from '../automation/normalize-control';
import { parseWatched, type WatchedApp } from '../../platform/apps';
import {
  appRequest,
  watchedKeys,
  appVariable,
  parseAppVariable,
  validAppVariable,
  watchedSelections,
} from './keys';
import { effectiveVariant } from '../controls/control-state';
import { validateStateConfiguration } from '../controls/state-validation';
import { evaluatePredicate } from '../automation/expression';
import { validateScenario } from '../automation/validate';
import type { Predicate } from '../automation/scenario';
import { settings } from '../settings/state.svelte';
import { appSlug, rememberApp } from './picker.svelte';
import { AppWatcher } from './watcher.svelte';

const state = (over: Partial<WatchedApp> = {}): WatchedApp => ({
  key: 'exe:C:/a/Chat.exe',
  slug: 'chat',
  running: true,
  focused: false,
  minimized: false,
  visible: true,
  display: 'Monitor',
  ...over,
});

describe('app requests', () => {
  it('never turns a graceful quit into a forced termination', () => {
    expect(appRequest('quit', { app: 'aumid:Chat' })).toEqual({ op: 'quit', app: 'aumid:Chat' });
    expect(() => appRequest('quit', { app: 'aumid:Chat', force: true })).toThrow(
      'Quit app cannot force close',
    );
  });

  it('refuses a missing or foreign app key before anything reaches the native side', () => {
    for (const app of [undefined, '', 'chat', 'path:C:/a.exe', 'exe:', 'exe:C:/a\n.exe']) {
      expect(() => appRequest('open', { app })).toThrow('Choose an app');
    }
    expect(
      appRequest('toggle', { app: 'aumid:Chat', display: '', hide: 'close', force: true }),
    ).toEqual({
      op: 'toggle',
      app: 'aumid:Chat',
      hide: 'close',
      force: true,
      windows: 'all',
      title: '',
    });
  });

  it('rejects malformed window scopes before they can target other windows', () => {
    for (const args of [
      { windows: 'recent' },
      { windows: null },
      { title: 3 },
      { windows: 'title', title: ' ' },
      { windows: 'window', title: 'Friends List' },
      { windows: 'window', window: 3 },
      { title: 'bad\nname' },
      { title: 'x'.repeat(1025) },
      { windows: 'main', hide: 'close', force: true },
    ]) {
      expect(() => appRequest('toggle', { app: 'aumid:Steam', ...args })).toThrow();
    }
    expect(appRequest('focus', { app: 'aumid:Steam', windows: 'title', title: ' Steam ' })).toEqual(
      { op: 'focus', app: 'aumid:Steam', windows: 'title', title: 'Steam' },
    );
    expect(
      appRequest('toggle', { app: 'aumid:Steam', windows: 'window', window: ' Friends List ' }),
    ).toEqual({ op: 'toggle', app: 'aumid:Steam', windows: 'window', title: 'Friends List' });
  });

  it('watches apps used by actions and apps added by hand, once each', () => {
    const control = normalizeControl({
      id: 'b',
      name: 'B',
      type: 'button',
      variants: [
        {
          label: '',
          icon: '',
          color: '#fff',
          action: { id: 'app.focus', args: { app: 'aumid:Chat' } },
        },
      ],
    });
    expect(watchedKeys([control], ['aumid:Chat', 'exe:C:/x.exe', 'junk'])).toEqual([
      'aumid:Chat',
      'exe:C:/x.exe',
    ]);
  });
});

describe('native app state', () => {
  it('keeps scoped conditions and bindings independent of the apps other windows', () => {
    const selection = { windows: 'window', title: 'Friends List' } as const;
    const id = appVariable('chat', 'visible', selection);
    const control = normalizeControl({
      id: 'b',
      type: 'button',
      variants: [{ id: 'off' }, { id: 'on' }],
      stateBindings: [{ variableId: id, cases: [{ value: true, stateId: 'on' }] }],
      scenario: {
        triggers: {
          press: {
            steps: [
              {
                id: 'if',
                kind: 'if',
                condition: {
                  kind: 'compare',
                  left: { kind: 'variable', id },
                  op: 'eq',
                  right: { kind: 'literal', value: true },
                },
                then: [],
                else: [],
              },
            ],
          },
        },
        events: [],
      },
    });
    expect(watchedSelections([control])).toEqual([{ slug: 'chat', ...selection }]);
    expect(validateStateConfiguration(control, { revision: 0, records: {} })).toEqual([]);
    const variables = new VariableStore();
    let push: (apps: WatchedApp[]) => void = () => {};
    const watcher = new AppWatcher({
      variables,
      keys: () => [],
      link: (onState) => {
        push = onState;
        return { watch: () => {}, stop: () => {} };
      },
      onError: () => {
        throw new Error('Watcher failed');
      },
    });
    const nativeSelection = { slug: 'chat', ...selection };
    for (const visible of [false, true]) {
      push([state({ visible: true }), state({ selection: nativeSelection, visible })]);
      expect(variables.getValue('app.chat.visible')).toBe(true);
      expect(variables.getValue(id)).toBe(visible);
      expect(effectiveVariant(control, variables.snapshot(), 0).stateId).toBe(
        visible ? 'on' : 'off',
      );
      expect(
        evaluatePredicate(
          {
            kind: 'compare',
            left: { kind: 'variable', id },
            op: 'eq',
            right: { kind: 'literal', value: true },
          },
          {
            getVariable: (key) => variables.getValue(key),
            findVariable: () => undefined,
            getState: () => undefined,
          },
        ),
      ).toBe(visible);
    }
    watcher.destroy();
  });

  it('rejects malformed scoped references instead of treating them as app-wide state', () => {
    const id = appVariable('chat', 'focused', { windows: 'title', title: 'A.b / 日本語' });
    expect(parseAppVariable(id)?.selection?.title).toBe('A.b / 日本語');
    expect(validAppVariable(id)).toBe(true);
    for (const suffix of [
      'bad%',
      encodeURIComponent('{"windows":"recent","title":"x"}'),
      encodeURIComponent('{"windows":"window","title":""}'),
    ]) {
      expect(validAppVariable(`app.chat.focused@${suffix}`)).toBe(false);
    }
    expect(parseWatched([{ ...state(), selection: { windows: 'recent', title: '' } }])).toEqual([]);
  });
  it('drops malformed entries so they never reach variables', () => {
    expect(
      parseWatched([
        state(),
        { ...state(), slug: '../x' },
        { ...state(), running: 'yes' },
        null,
        3,
      ]),
    ).toEqual([state()]);
    expect(parseWatched({ apps: [] })).toEqual([]);
  });

  it('publishes app state as read-only variables, keeps them current and retires them with the app', () => {
    const variables = new VariableStore();
    let push: (apps: WatchedApp[]) => void = () => {};
    const watcher = new AppWatcher({
      variables,
      keys: () => ['exe:C:/a/Chat.exe'],
      link: (onState) => {
        push = onState;
        return { watch: () => {}, stop: () => {} };
      },
      onError: () => {},
    });
    push([state()]);
    push([state({ focused: true, display: 'Side' })]);
    expect(variables.getValue('app.chat.focused')).toBe(true);
    expect(variables.getValue('app.chat.display')).toBe('Side');
    expect(() => variables.set('app.chat.running', false)).toThrow('read-only');
    push([]);
    expect(variables.get('app.chat.running')).toBeUndefined();
    watcher.destroy();
  });
});

describe('app conditions', () => {
  const condition = (op: 'eq' | 'ne', value: boolean | string = true): Predicate => ({
    kind: 'compare',
    left: { kind: 'variable', id: 'app.chat.running' },
    op,
    right: { kind: 'literal', value },
  });

  it('follows the published app variable, both for "is" and "is not"', () => {
    const variables = new VariableStore();
    let push: (apps: WatchedApp[]) => void = () => {};
    const watcher = new AppWatcher({
      variables,
      keys: () => ['exe:C:/a/Chat.exe'],
      link: (onState) => {
        push = onState;
        return { watch: () => {}, stop: () => {} };
      },
      onError: () => {},
    });
    const env = {
      getVariable: (id: string) => variables.getValue(id),
      findVariable: () => undefined,
      getState: () => undefined,
    };
    push([state({ running: true })]);
    expect(evaluatePredicate(condition('eq'), env)).toBe(true);
    expect(evaluatePredicate(condition('ne'), env)).toBe(false);
    push([state({ running: false })]);
    expect(evaluatePredicate(condition('eq'), env)).toBe(false);
    expect(evaluatePredicate(condition('ne'), env)).toBe(true);
    watcher.destroy();
  });

  it('refuses to compare an app state with text, which is what an unfilled right side was', () => {
    const env = {
      getVariable: () => true,
      findVariable: () => undefined,
      getState: () => undefined,
    };
    const broken = condition('eq', '');
    expect(() => evaluatePredicate(broken, env)).toThrow('same type');
  });

  it('names the variable like the native watcher and watches an app once it is picked', () => {
    expect(appSlug('exe:C:/Apps/My App_2.EXE')).toBe('myapp_2');
    settings.apps = [];
    rememberApp('exe:C:/a/Chat.exe');
    expect(watchedKeys(settings.controls, settings.apps)).toContain('exe:C:/a/Chat.exe');
  });

  it('keeps non-ASCII executable conditions aligned with native state ids', () => {
    const slug = appSlug('exe:C:/Apps/Контур.Коннект.exe');
    expect(slug).toBe('u_d0bad0bed0bdd182d183d1802ed0bad0bed0bdd0bdd0b5d0bad182');
    expect(appSlug('exe:C:/Apps/КОНТУР.КОННЕКТ.EXE')).toBe(slug);
    expect(appSlug('exe:C:/Apps/Толк.exe')).not.toBe(slug);
    expect(parseAppVariable(`app.${slug}.running`)).toEqual({ slug, field: 'running' });
    expect(parseWatched([state({ slug })])).toHaveLength(1);
  });

  it.each(['running', 'focused', 'minimized', 'visible'])(
    'keeps "if app is not %s then open, else minimize" a valid scenario',
    (field) => {
      const step = (id: string, action: string) => ({
        id,
        kind: 'action',
        action: { id: action, args: { app: 'aumid:Steam' } },
      });
      for (const op of ['eq', 'ne'] as const) {
        const scenario = {
          triggers: {
            press: {
              steps: [
                {
                  id: 'if',
                  kind: 'if',
                  condition: {
                    kind: 'compare',
                    left: { kind: 'variable', id: `app.steam.${field}` },
                    op,
                    right: { kind: 'literal', value: true },
                  },
                  then: [step('open', 'app.open')],
                  else: [step('min', 'app.minimize')],
                },
              ],
            },
          },
        };
        expect(validateScenario(scenario)).toEqual([]);
      }
    },
  );
});

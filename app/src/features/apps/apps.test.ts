import { describe, expect, it } from 'vitest';
import { VariableStore } from '../automation/variables';
import { normalizeControl } from '../automation/normalize-control';
import { parseWatched, type WatchedApp } from '../../platform/apps';
import { appRequest, watchedKeys } from './keys';
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
    });
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

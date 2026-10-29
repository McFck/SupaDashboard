import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionDef, PluginApi } from '../features/plugins/contracts';

const state = vi.hoisted(() => ({
  controls: [] as { id: string; type: string }[],
  target: undefined as undefined | { sourceId?: string; sessionId: string },
  command: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('../platform/media', () => ({ nativeSessions: () => () => () => {} }));
vi.mock('../features/settings/state.svelte', () => ({
  settings: {
    get controls() {
      return state.controls;
    },
  },
}));
vi.mock('../app/runtime/session.svelte', () => ({
  currentRuntime: () => ({ isOwner: true, nowPlayingTarget: () => state.target }),
}));
vi.mock('../features/plugins/registry', () => ({
  mediaSources: new Map([
    [
      'system',
      { id: 'system', title: 'System', command: (...args: unknown[]) => state.command(...args) },
    ],
  ]),
}));
vi.mock('../features/plugins/content-targets', () => ({ contentTargets: () => [] }));

async function actions() {
  const { registerCoreMedia } = await import('./core-media');
  const found = new Map<string, ActionDef>();
  registerCoreMedia({
    registerMediaSource: () => {},
    registerStatusSource: () => {},
    registerAction: (def: ActionDef) => void found.set(def.id, def),
  } as unknown as PluginApi);
  return found;
}
const context = { signal: new AbortController().signal, controlId: 'np' } as never;

beforeEach(() => {
  state.controls = [{ id: 'np', type: 'nowPlaying' }];
  state.target = { sourceId: 'system', sessionId: 'App#1' };
  state.command.mockReset().mockResolvedValue(true);
});

describe('media routing', () => {
  it("sends a now-playing widget's skip to the exact session it shows", async () => {
    const next = (await actions()).get('media.next');
    await next?.run({ target: 'self' }, context);
    expect(state.command).toHaveBeenCalledWith('next', 'App#1');
  });

  it('fails instead of picking another player when nothing is shown, the source is display-only, or sources conflict', async () => {
    const next = (await actions()).get('media.next');
    state.target = undefined;
    await expect(next?.run({ target: 'self' }, context)).rejects.toThrow('Nothing is playing');
    state.target = { sessionId: 'App#1' };
    await expect(next?.run({ target: 'self' }, context)).rejects.toThrow('cannot be controlled');
    state.target = { sourceId: 'system', sessionId: 'App#1' };
    await expect(next?.run({ target: 'self', source: 'spotify' }, context)).rejects.toThrow(
      'another media source',
    );
    expect(state.command).not.toHaveBeenCalled();
  });

  it('turns a transport that no player took into a failed action', async () => {
    const actionMap = await actions();
    state.command.mockResolvedValue(false);
    await expect(actionMap.get('media.toggle')?.run({}, context)).rejects.toThrow('No player');
    await expect(actionMap.get('media.next')?.run({ target: 'self' }, context)).rejects.toThrow(
      'No player',
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import { EventRegistry } from './events';
import type { ControlConfig } from '../controls/model';
import type { EventList } from './scenario';

const listener = (id: string, parameter?: string): EventList => ({
  id,
  eventId: 'counter.changed',
  ...(parameter === undefined ? {} : { parameter }),
  list: { steps: [] },
});
const control = (id: string, ...events: EventList[]): ControlConfig => ({
  id,
  name: id,
  type: 'button',
  variants: [],
  scenario: { triggers: {}, events },
});

describe('event registry', () => {
  it('matches any, exact and empty parameters and emits once per listener', async () => {
    const registry = new EventRegistry();
    registry.register({ id: 'counter.changed', title: 'Counter changed', plugin: 'core' });
    const controls = [
      control('any', listener('any')),
      control('exact', listener('exact', 'count')),
      control('empty', listener('empty', '')),
      control('two', listener('same'), listener('same2', 'count')),
    ];
    const dispatched: string[] = [];
    const dispatch = async (target: import('./events').EventTarget) => {
      dispatched.push(target.listener.id);
    };
    await registry.emit('counter.changed', 'count', { n: 1 }, controls, dispatch);
    expect(dispatched).toEqual(['any', 'exact', 'same', 'same2']);
    dispatched.length = 0;
    await registry.emit('counter.changed', '', null, controls, dispatch);
    expect(dispatched).toEqual(['any', 'empty', 'same']);
  });

  it('caps causal depth, avoids listener re-entry and validates payloads', async () => {
    const registry = new EventRegistry();
    registry.register({ id: 'counter.changed', title: 'Counter changed' });
    const controls = [control('c', listener('l'))],
      cycles = vi.fn(),
      dispatch = vi.fn(async () => {});
    await registry.emit(
      'counter.changed',
      undefined,
      undefined,
      controls,
      dispatch,
      { depth: 1, listeners: ['c\u0000l'] },
      cycles,
    );
    expect(dispatch).not.toHaveBeenCalled();
    expect(cycles).toHaveBeenCalledOnce();
    await expect(
      registry.emit('counter.changed', undefined, { bad: 1n }, controls, dispatch),
    ).rejects.toThrow('serializable');
    await registry.emit(
      'counter.changed',
      undefined,
      null,
      controls,
      dispatch,
      { depth: 16, listeners: [] },
      cycles,
    );
    expect(dispatch).not.toHaveBeenCalled();
    expect(cycles).toHaveBeenCalledOnce();
  });
});

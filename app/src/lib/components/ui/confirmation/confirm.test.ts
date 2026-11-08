import { beforeEach, describe, expect, it } from 'vitest';
import { completeConfirmation, confirm, confirmationState, disposeConfirmations, settleConfirmation } from './confirm.svelte';

beforeEach(disposeConfirmations);

describe('promise confirmations', () => {
  it('resolves yes once and rejects stale settlement IDs', async () => {
    const result = confirm({ title: 'Reset everything?', action: 'Reset', destructive: true });
    const id = confirmationState.current!.id;
    expect(settleConfirmation(id, true)).toBe(true);
    expect(settleConfirmation(id, false)).toBe(false);
    expect(await result).toBe(true);
    expect(completeConfirmation(id)).toBe(true);
    expect(completeConfirmation(id)).toBe(false);
  });

  it('resolves cancel, Escape and outside dismissal as false', async () => {
    for (const reason of ['cancel', 'escape', 'outside']) {
      const result = confirm({ title: reason, action: 'Continue' });
      const id = confirmationState.current!.id;
      expect(settleConfirmation(id, false)).toBe(true);
      expect(await result).toBe(false);
      expect(completeConfirmation(id)).toBe(true);
    }
  });

  it('presents concurrent requests FIFO after each completed close', async () => {
    const first = confirm({ title: 'First', action: 'OK' });
    const firstId = confirmationState.current!.id;
    const second = confirm({ title: 'Second', action: 'OK' });
    const secondId = confirmationState.queue[0].id;
    expect(confirmationState.current!.id).toBe(firstId);
    expect(settleConfirmation(firstId, true)).toBe(true);
    expect(completeConfirmation(firstId)).toBe(true);
    expect(confirmationState.current!.id).toBe(secondId);
    expect(settleConfirmation(firstId, false)).toBe(false);
    expect(settleConfirmation(secondId, false)).toBe(true);
    expect(completeConfirmation(secondId)).toBe(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
  });

  it('resolves active and queued requests false when the host is disposed', async () => {
    const active = confirm({ title: 'Active', action: 'OK' });
    const queued = confirm({ title: 'Queued', action: 'OK' });
    disposeConfirmations();
    await expect(active).resolves.toBe(false);
    await expect(queued).resolves.toBe(false);
    expect(confirmationState.current).toBeNull();
    expect(confirmationState.queue).toHaveLength(0);
  });
});

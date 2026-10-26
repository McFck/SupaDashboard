import { describe, expect, it } from 'vitest';
import { animateRemoval, dustParticles, registerRemovalNode } from './removal';

describe('dust particles', () => {
  it('samples positions inside the tile, bounds particle count and uses its palette', () => {
    const particles = dustParticles(1000, 800, ['#123456', '#abcdef'], () => 0.5);
    expect(particles.length).toBeGreaterThan(800);
    expect(particles.length).toBeLessThanOrEqual(930);
    expect(
      particles.every(
        (p) => p.x > 0 && p.x < 1000 && p.y > 0 && p.y < 800 && p.color === '#abcdef',
      ),
    ).toBe(true);
    expect(particles.every((p) => p.vx > 0 && p.vy < 0 && p.delay < 0.15)).toBe(true);
    expect(dustParticles(0, 0, [])).toEqual([]);
  });
});

describe('removal start notifications', () => {
  it('notifies each live grid synchronously once and deduplicates pending calls', async () => {
    const id = `sync-${Math.random()}`;
    const starts: string[] = [];
    const first = registerRemovalNode({ isConnected: false } as HTMLElement, id, () =>
      starts.push('first'),
    );
    const removed = registerRemovalNode({ isConnected: false } as HTMLElement, id, () =>
      starts.push('removed'),
    );
    const second = registerRemovalNode({ isConnected: false } as HTMLElement, id, () =>
      starts.push('second'),
    );
    removed.destroy();

    const pending = animateRemoval(id);
    expect(starts).toEqual(['first', 'second']);
    expect(animateRemoval(id)).toBe(pending);
    expect(starts).toEqual(['first', 'second']);
    await pending;
    first.destroy();
    second.destroy();
  });

  it('retains two-argument registration compatibility', async () => {
    const id = `legacy-${Math.random()}`;
    const registration = registerRemovalNode({ isConnected: false } as HTMLElement, id);
    await animateRemoval(id);
    registration.destroy();
  });
});

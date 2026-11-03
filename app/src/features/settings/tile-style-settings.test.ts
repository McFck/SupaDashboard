import { describe, expect, it } from 'vitest';
import { migrate } from './normalize';

const tile = (variant: Record<string, unknown>) => ({
  id: 'tile',
  type: 'button',
  variants: [{ label: 'Mute', ...variant }],
});

describe('settings v16 tile styles', () => {
  it('keeps the default face for older states and the chosen style for newer ones', () => {
    const old = migrate({ version: 15, controls: [tile({})] });
    expect(old.version).toBe(16);
    expect(old.controls[0].variants[0].style).toBeUndefined();
    const styled = migrate({
      version: 16,
      controls: [tile({ style: 'app', icon: 'brand-steam' })],
    });
    expect(styled.controls[0].variants[0]).toMatchObject({ style: 'app', icon: 'brand-steam' });
  });

  it('refuses an unknown style instead of loading and saving over it', () => {
    expect(() => migrate({ version: 16, controls: [tile({ style: 'neon' })] })).toThrow(
      'Variant style is unknown',
    );
  });
});

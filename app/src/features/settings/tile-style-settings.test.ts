import { describe, expect, it } from 'vitest';
import { migrate } from './normalize';

const tile = (variant: Record<string, unknown>) => ({
  id: 'tile',
  type: 'button',
  variants: [{ label: 'Mute', ...variant }],
});

describe('settings v17 tile styles', () => {
  it('keeps the default face for older states and the chosen style for newer ones', () => {
    const old = migrate({ version: 15, controls: [tile({})] });
    expect(old.version).toBe(23);
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

  it('round trips app identities while preserving v16 brand icon faces', () => {
    const app = String.raw`exe:C:\Games\Stolen Realm\Stolen Realm.exe`;
    const saved = migrate({ version: 17, controls: [tile({ style: 'app', app })] });
    expect(migrate(saved).controls[0].variants[0].app).toBe(app);
    expect(() =>
      migrate({ version: 17, controls: [tile({ style: 'app', app: 'file:///secret' })] }),
    ).toThrow('Variant app is invalid');
    expect(
      migrate({ version: 16, controls: [tile({ style: 'app', icon: 'brand-steam' })] }).controls[0]
        .variants[0],
    ).toMatchObject({ style: 'app', icon: 'brand-steam' });
  });
});

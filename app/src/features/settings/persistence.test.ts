import { describe, expect, it } from 'vitest';
import { SettingsPersistence } from './persistence';

describe('settings persistence', () => {
  it('keeps a failed snapshot unsaved so retrying the same settings writes them', async () => {
    let failing = true;
    let stored = 'original';
    const persistence = new SettingsPersistence(async (json) => {
      if (failing) {
        throw new Error('Disk full');
      }
      stored = json;
    }, stored);

    await expect(persistence.save('edited')).rejects.toThrow('Disk full');
    expect(persistence.saved).toBe('original');
    expect(stored).toBe('original');
    failing = false;
    await persistence.save('edited');
    expect(stored).toBe('edited');
    expect(persistence.saved).toBe('edited');
  });

  it('writes the latest edit after an in-flight save without allowing an older write to win', async () => {
    let finish!: () => void;
    let stored = 'original';
    const persistence = new SettingsPersistence(async (json) => {
      if (json === 'first') {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
      stored = json;
    }, stored);
    const saving = persistence.save('first');
    persistence.save('latest');
    expect(persistence.saved).toBe('original');
    finish();
    await saving;
    expect(stored).toBe('latest');
    expect(persistence.saved).toBe('latest');
  });
});

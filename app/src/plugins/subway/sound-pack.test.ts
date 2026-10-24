import { describe, expect, it } from 'vitest';
import { resolveAssetUrl, resolveCue, selectDirectionalEntries, type RuntimeCueManifest } from './sound-pack';

const manifest: RuntimeCueManifest = {
  version: 1,
  inputs: {},
  cues: [{
    file: 'lines/yamanote/clips/voice/test.opus',
    offset: 0.1,
    duration: 2,
    audible_end: 1.8,
    gainByRole: { voice: 0.75, melody: 0.4 },
    sha256: 'a'.repeat(64),
    status: 'needs ear check',
    source: [{ source: 'test source', revision: 'round5' }],
  }],
};

describe('Subway sound pack', () => {
  it('resolves clips inside the same-origin staged directory', () => {
    expect(resolveAssetUrl('lines/yamanote/clips/a b.opus', 'http://localhost/subway/'))
      .toBe('http://localhost/subway/lines/yamanote/clips/a%20b.opus');
    expect(() => resolveAssetUrl('../outside.opus', 'http://localhost/subway/')).toThrow(/Unsafe/);
    expect(() => resolveAssetUrl('/outside.opus', 'http://localhost/subway/')).toThrow(/Unsafe/);
  });

  it('uses measured offsets and the requested role gain without changing review status', () => {
    const cue = resolveCue({ file: manifest.cues[0].file }, 'voice', manifest, 'http://localhost/subway/');
    expect(cue).toMatchObject({ offset: 0.1, duration: 2, audible_end: 1.8, gain: 0.75, status: 'needs ear check' });
    expect(cue.url).toContain('/subway/lines/yamanote/clips/voice/test.opus');
    expect(() => resolveCue({ file: manifest.cues[0].file }, 'bell', manifest, 'http://localhost/subway/'))
      .toThrow(/Missing bell catalogue entry/);
  });

  it('rejects wrong-direction singleton fallbacks and prefers exact over compatible entries', () => {
    const wrong = [{ file: 'outer.opus', direction: 'outer' }];
    expect(selectDirectionalEntries(wrong, 'inner')).toEqual([]);
    const entries = [
      { file: 'compatible.opus', directions: ['inner', 'outer'] },
      { file: 'exact.opus', direction: 'inner' },
      { file: 'duplicate.opus', direction: 'inner' },
      { file: 'duplicate.opus', direction: 'inner' },
    ];
    expect(selectDirectionalEntries(entries, 'inner').map(entry => entry.file)).toEqual(['exact.opus', 'duplicate.opus']);
  });
});

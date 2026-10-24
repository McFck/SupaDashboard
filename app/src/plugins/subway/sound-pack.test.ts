import { describe, expect, it, vi } from 'vitest';
import { buildSegmentCuePlan, resolveAssetUrl, resolveCue, selectDirectionalEntries, selectStationEntries,
  type DoorSequenceApi, type LoadedSubwayLine, type RuntimeCueManifest, type RuntimeCue } from './sound-pack';

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
const packModules = import.meta.glob('../../../../assets/lines/*/pack.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>;
const runtimeCatalogue = Object.values(import.meta.glob('../../../../assets/motion/runtime-cues.json', { eager: true, import: 'default' }) as Record<string, RuntimeCueManifest>)[0];

function referencedFiles(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) referencedFiles(item, result);
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.file === 'string') result.add(record.file);
    for (const [key, child] of Object.entries(record)) if (key !== 'file') referencedFiles(child, result);
  }
  return result;
}

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

  it('catalogues every pack clip, including station-specific door variants', () => {
    const referenced = new Set(Object.values(packModules).flatMap(pack => [...referencedFiles(pack)]));
    const catalogued = new Set(runtimeCatalogue.cues.map(cue => cue.file));
    expect([...referenced].filter(file => !catalogued.has(file))).toEqual([]);
  });

  it('uses the line default once when a station-specific cue is unavailable', () => {
    const defaultFile = 'lines/hibiya/clips/platform-door/platform-door_tokyo-metro-platform-door-ch_07.opus';
    const missingVariant = 'lines/hibiya/clips/platform-door/platform-door_tokyo-metro-platform-door-ch_09.opus';
    const fallbackManifest: RuntimeCueManifest = { version: 1, inputs: {}, cues: [{
      file: defaultFile, offset: 0, duration: 2, audible_end: 1.8, gainByRole: { signal: 0.5 },
      sha256: 'f'.repeat(64), status: 'needs ear check', source: 'fixture',
    }] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const record = { file: defaultFile, variants: [{ stations: ['H22'], file: missingVariant }] };
      const first = resolveCue(record, 'signal', fallbackManifest, 'http://localhost/subway/', 'H22');
      const second = resolveCue(record, 'signal', fallbackManifest, 'http://localhost/subway/', 'H22');
      expect(first.file).toBe(defaultFile);
      expect(second.file).toBe(defaultFile);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
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

  it('requires station and kind matches before direction fallback', () => {
    const entries = [
      { file: 'wrong-direction.opus', station: 'H22', kind: 'next', direction: 'to-naka-meguro' },
      { file: 'wrong-station.opus', station: 'H21', kind: 'next', directions: ['to-kita-senju'] },
      { file: 'wrong-kind.opus', station: 'H22', kind: 'transfer', directions: ['to-kita-senju'] },
      { file: 'compatible.opus', station: 'H22', kind: 'next', directions: ['to-kita-senju'] },
    ];
    expect(selectStationEntries(entries, 'H22', 'next', 'to-kita-senju').map(entry => entry.file)).toEqual(['compatible.opus']);
  });

  it('selects H22 door variants before planning and pads only verified station queues', () => {
    const files = [
      'lines/hibiya/clips/door/default.opus', 'lines/hibiya/clips/door/h22.opus',
      'lines/hibiya/clips/voice/next-ja.opus', 'lines/hibiya/clips/voice/next-en.opus',
      'lines/hibiya/clips/voice/arriving-ja.opus', 'lines/hibiya/clips/voice/emergency.opus',
    ];
    const catalogue: RuntimeCueManifest = { version: 1, inputs: {}, cues: files.map(file => ({
      file, offset: 0, duration: 2, audible_end: 1.8,
      gainByRole: { voice: 1, signal: 1, mechanics: 1, melody: 1 }, sha256: 'b'.repeat(64), status: 'needs ear check', source: 'fixture',
    })) };
    const line: LoadedSubwayLine = { line: {}, pack: {
      id: 'hibiya',
      stations: [
        { code: 'H21', departure_melody: {} },
        { code: 'H22',
          next: { ja: [
            { file: 'lines/hibiya/clips/voice/next-ja.opus', station: 'H22', kind: 'next', directions: ['to-kita-senju'], lang: 'ja' },
            { file: 'lines/hibiya/clips/voice/other.opus', station: 'H22', kind: 'next', direction: 'to-naka-meguro', lang: 'ja' },
          ], en: [{ file: 'lines/hibiya/clips/voice/next-en.opus', station: 'H22', kind: 'next', direction: 'to-kita-senju', lang: 'en' }] },
          arriving: { ja: [{ file: 'lines/hibiya/clips/voice/arriving-ja.opus', station: 'H22', kind: 'arriving', direction: 'to-kita-senju', lang: 'ja' }] },
          transfer: { ja: [{ file: 'lines/hibiya/clips/voice/other.opus', station: 'H22', kind: 'transfer', direction: 'to-kita-senju', lang: 'ja' }] },
        },
      ],
      doors: {
        sequence: { close: [{ part: 'departure_melody', at: 0 }, { part: 'platform_open', at: 0.5 }], open: [{ part: 'platform_open', at: 0 }] },
        platform_open: { file: files[0], variants: [{ stations: ['H22'], file: files[1] }] },
      },
      emergency: [
        { file: 'lines/hibiya/clips/voice/emergency.opus', kind: 'emergency', scenario: 'emergency stop', lang: 'ja', direction: 'to-kita-senju' },
        { file: 'lines/hibiya/clips/voice/other.opus', kind: 'emergency', scenario: 'power outage', lang: 'ja', direction: 'to-kita-senju' },
      ],
    } };
    const calls: { action: string; platformFile: string; sequence: Record<string, unknown> }[] = [];
    const planner: DoorSequenceApi = { plan(input, action) {
      calls.push({ action, platformFile: input.cues.platform_open.file, sequence: input.sequence as Record<string, unknown> });
      return { events: [], end: 1, close_end: 0.8, open_end: 0.7 };
    } };
    const segment = buildSegmentCuePlan(line, 'H21', 'H22', 'to-kita-senju', ['ja', 'en'], false,
      catalogue, 'http://localhost/subway/', planner);
    expect(calls.find(call => call.action === 'open')?.platformFile).toBe(files[1]);
    expect(calls.find(call => call.action === 'close')?.platformFile).toBe(files[0]);
    expect((calls[0].sequence.close as unknown[])).toHaveLength(1);
    expect(segment.preClose).toBeUndefined();
    expect(segment.departure.map(item => item.cue.file)).toEqual([files[2], files[3]]);
    expect(segment.arrival.map(item => item.cue.file)).toEqual([files[4]]);
    expect(segment.emergency?.map(item => item.cue.file)).toEqual([files[5]]);
    expect(Object.isFrozen(segment) && Object.isFrozen(segment.departure)).toBe(true);
  });

  it('places an available station melody before the door plan when its sequence omits it', () => {
    const melodyFile = 'lines/yamanote/clips/melody/station.opus';
    const catalogue: RuntimeCueManifest = { ...manifest, cues: [...manifest.cues, {
      file: melodyFile, offset: 0, duration: 3, audible_end: 2.9, gainByRole: { melody: 0.4 },
      sha256: 'c'.repeat(64), status: 'approved', source: 'fixture',
    }] };
    const line: LoadedSubwayLine = { line: {}, pack: {
      id: 'yamanote', stations: [
        { code: 'JY01', departure_melody: { inner: { file: melodyFile } } },
        { code: 'JY02', next: {} },
      ],
      doors: { sequence: { close: [{ part: 'close', at: 0 }], open: [{ part: 'open', at: 0 }] },
        close: { file: 'lines/yamanote/clips/door/close.opus' }, open: { file: 'lines/yamanote/clips/door/open.opus' } },
    } };
    const allFiles = [...catalogue.cues, ...['close', 'open'].map(name => ({
      file: `lines/yamanote/clips/door/${name}.opus`, offset: 0, duration: 1, audible_end: 0.9,
      gainByRole: { mechanics: 1 }, sha256: 'd'.repeat(64), status: 'approved', source: 'fixture',
    }))] as RuntimeCue[];
    const planner: DoorSequenceApi = { plan: () => ({ events: [], end: 0 }) };
    const segment = buildSegmentCuePlan(line, 'JY01', 'JY02', 'inner', ['ja'], false,
      { ...catalogue, cues: allFiles }, 'http://localhost/subway/', planner);
    expect(segment.preClose?.[0]).toMatchObject({ part: 'departure_melody', at: 0, cue: { file: melodyFile, gain: 0.4 } });
  });
});

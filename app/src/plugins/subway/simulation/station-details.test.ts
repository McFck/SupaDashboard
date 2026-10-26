import { describe, expect, it } from 'vitest';
import {
  buildDirectionDetails,
  transferSupplements,
  validatePlatformFacilities,
  type PlatformFacility,
} from './station-details';

const facility: PlatformFacility = {
  kind: 'lift',
  car: null,
  relativePosition: null,
  label: 'Elevator',
  source: 'station map',
  revision: '2026-10-24',
};

describe('Subway station details', () => {
  it('provides safe, immutable defaults for every direction and formation car', () => {
    const details = buildDirectionDetails(['inner', 'outer'], 11);
    expect(Object.keys(details.doorByDirection)).toEqual(['inner', 'outer']);
    expect(details.doorByDirection.inner).toMatchObject({ side: 'unknown', synthetic: true });
    expect(details.platformByDirection.outer).toMatchObject({
      carOrder: Array.from({ length: 11 }, (_, index) => index + 1),
      facilities: [],
      synthetic: true,
    });
    expect(Object.isFrozen(details)).toBe(true);
    expect(Object.isFrozen(details.platformByDirection.outer.carOrder)).toBe(true);
  });

  it('keeps direction evidence and resolves conflicting sides to unknown', () => {
    const details = buildDirectionDetails(['north', 'south'], 8, [
      { direction: 'north', side: 'left', source: 'northbound map', revision: 'r1' },
      { direction: 'south', side: 'right', source: 'southbound map', revision: 'r1' },
      { direction: 'south', side: 'left', source: 'conflicting note', revision: 'r2' },
    ]);
    expect(details.doorByDirection.north).toMatchObject({ side: 'left', synthetic: false });
    expect(details.doorByDirection.south).toMatchObject({ side: 'unknown', synthetic: true });
    expect(details.doorByDirection.south.provenance).toContain('conflicting note');
  });

  it('rejects invalid directions and formation references', () => {
    expect(() => buildDirectionDetails([], 8)).toThrow(/directions/i);
    expect(() => buildDirectionDetails(['north', 'north'], 8)).toThrow(/directions/i);
    expect(() =>
      buildDirectionDetails(['north'], 8, [{ direction: 'south', side: 'left', source: 'map' }]),
    ).toThrow(/Unknown door-side direction/);
    expect(() => buildDirectionDetails(['north'], 0)).toThrow(/formation car count/i);
  });

  it('allows unassigned facilities without inventing a car or platform position', () => {
    expect(() => validatePlatformFacilities([facility], 8)).not.toThrow();
    expect(() => validatePlatformFacilities([{ ...facility, car: 9 }], 8)).toThrow(/facility car/i);
    expect(() => validatePlatformFacilities([{ ...facility, relativePosition: 1.1 }], 8)).toThrow(
      /facility position/i,
    );
    expect(() =>
      validatePlatformFacilities(
        [{ ...facility, kind: 'teleporter' as PlatformFacility['kind'] }],
        8,
      ),
    ).toThrow(/facility kind/i);
    expect(() => validatePlatformFacilities([{ ...facility, source: '' }], 8)).toThrow(/source/i);
  });

  it('keeps researched transfer text and badge codes traceable', () => {
    expect(transferSupplements.hibiya.H16).toMatchObject({
      codes: ['S08'],
      source: expect.stringContaining('kotsu.metro.tokyo.jp'),
    });
    expect(transferSupplements.hibiya.H18?.text?.en).toContain('Keisei');
    for (const code of ['K11', 'K12', 'K13', 'K14', 'K17', 'K18', 'K19', 'K20']) {
      expect(transferSupplements.sakaisuji[code]).toMatchObject({
        source: expect.stringContaining('osakametro.co.jp'),
        revision: '2026-10-24',
      });
    }
  });
});

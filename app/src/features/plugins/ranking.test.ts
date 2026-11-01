import { describe, expect, it } from 'vitest';
import { rankOptions } from './ranking';

const option = (label: string) => ({ value: `id-${label}`, label });

describe('rankOptions', () => {
  it('puts exact, prefix, word-prefix, substring and fuzzy matches in that order and drops the rest', () => {
    const options = ['Subway time', 'Mega bus', 'bus', 'Busy', 'Bxuxs', 'Volume'].map(option);
    expect(rankOptions(options, 'bus').map((item) => item.label)).toEqual([
      'bus',
      'Busy',
      'Mega bus',
      'Bxuxs',
    ]);
  });
});

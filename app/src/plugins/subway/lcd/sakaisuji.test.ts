import { describe, expect, it } from 'vitest';
import { normalizeSubwayLines, stepStation } from '../lines';
import type { RunSnapshot } from '../run';
import { scheduleScreen } from '../screens';
import { sakaisujiCarOrder, sakaisujiLayout, sakaisujiNearbyStations, sakaisujiOrderedStations,
  SAKAISUJI_COLORS } from './sakaisuji';

const lineFiles = import.meta.glob('../../../../../assets/lines/*/line.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const packFiles = import.meta.glob('../../../../../assets/lines/*/pack.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const lines = normalizeSubwayLines(['yamanote', 'hibiya', 'sakaisuji'].map(id => ({
  line: Object.entries(lineFiles).find(([path]) => path.endsWith(`/lines/${id}/line.json`))?.[1],
  pack: Object.entries(packFiles).find(([path]) => path.endsWith(`/lines/${id}/pack.json`))?.[1],
})));
const sakaisuji = lines.find(line => line.id === 'sakaisuji')!;

function model(station = 'K15', direction = 'southbound') {
  const next = stepStation(sakaisuji, station, direction)?.code ?? '';
  const snapshot: RunSnapshot = {
    station, next, state: 'cruising', line: 'sakaisuji', direction, doorSide: 'unknown', doors: 'closed',
    speed: 42, power: 0.35, brake: 0, progress: 0.5, paused: false, immersion: false,
    generation: 1, multiplier: 1, remainingMinutes: 9,
  };
  return scheduleScreen(snapshot, { line: sakaisuji, languages: ['ja', 'kana'] }, 0);
}

describe('Hankyu 1300 Sakaisuji LCD geometry', () => {
  it('uses a 1920x540 screen with a separate 108px brown header', () => {
    expect(sakaisujiLayout()).toMatchObject({
      width: 1920, height: 540, header: { x: 0, y: 0, width: 1920, height: 108 },
      body: { x: 0, y: 108, width: 1920, height: 432 },
    });
    expect(SAKAISUJI_COLORS.header).not.toBe(SAKAISUJI_COLORS.route);
    expect(SAKAISUJI_COLORS.route).not.toBe(SAKAISUJI_COLORS.next);
  });

  it('orders all ten K stations for southbound and northbound travel', () => {
    const southbound = sakaisujiOrderedStations(model('K11', 'southbound'));
    const northbound = sakaisujiOrderedStations(model('K20', 'northbound'));
    expect(southbound).toHaveLength(10);
    expect(northbound).toHaveLength(10);
    expect(southbound[0].code).toBe('K11');
    expect(southbound.at(-1)?.code).toBe('K20');
    expect(northbound.map(station => station.code)).toEqual(southbound.map(station => station.code).reverse());
  });

  it('windows six nearby stops with one passed stop when available', () => {
    for (const direction of sakaisuji.directions) {
      const ordered = direction.delta > 0 ? [...sakaisuji.stations] : [...sakaisuji.stations].reverse();
      for (const station of sakaisuji.stations) {
        const currentIndex = ordered.findIndex(item => item.code === station.code);
        const visible = sakaisujiNearbyStations(model(station.code, direction.id));
        const start = Math.max(0, Math.min(currentIndex - 1, ordered.length - 6));
        expect(visible).toHaveLength(6);
        expect(visible.map(item => item.code)).toEqual(ordered.slice(start, start + 6).map(item => item.code));
        expect(visible.some(item => item.code === station.code)).toBe(true);
      }
    }
  });

  it('keeps eight numbered cars in the formation for either direction', () => {
    const expected = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const direction of sakaisuji.directions) {
      const order = sakaisujiCarOrder(model('K15', direction.id));
      expect([...order].sort((left, right) => left - right)).toEqual(expected);
    }
  });
});

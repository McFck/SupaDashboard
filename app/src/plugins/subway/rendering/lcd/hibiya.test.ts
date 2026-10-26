import { describe, expect, it } from 'vitest';
import { normalizeSubwayLines, stepStation } from '../../simulation/lines';
import type { RunSnapshot } from '../../simulation/run';
import {
  createHibiyaRenderer,
  hibiyaLanguageFrame,
  HIBIYA_FLIP_MS,
  scheduleHibiyaPair,
  HIBIYA_LCD_HEIGHT,
  HIBIYA_LCD_WIDTH,
  HIBIYA_MULLION_WIDTH,
  HIBIYA_PANEL_HEIGHT,
  HIBIYA_PANEL_WIDTH,
  hibiyaPanelStations,
  hibiyaRouteWindow,
} from './hibiya';

const lineFiles = import.meta.glob('../../../../../../assets/lines/*/line.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const packFiles = import.meta.glob('../../../../../../assets/lines/*/pack.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;
const lines = normalizeSubwayLines(
  ['yamanote', 'hibiya', 'sakaisuji'].map((id) => ({
    line: Object.entries(lineFiles).find(([path]) => path.endsWith(`/lines/${id}/line.json`))?.[1],
    pack: Object.entries(packFiles).find(([path]) => path.endsWith(`/lines/${id}/pack.json`))?.[1],
  })),
);
const hibiya = lines.find((line) => line.id === 'hibiya')!;

function snapshot(station = 'H14', direction = 'to-kita-senju', next?: string): RunSnapshot {
  const following = next ?? stepStation(hibiya, station, direction)?.code ?? '';
  return {
    station,
    next: following,
    state: 'cruising',
    line: 'hibiya',
    direction,
    doorSide: 'unknown',
    doors: 'closed',
    speed: 48,
    power: 0.35,
    brake: 0,
    progress: 0.4,
    paused: false,
    immersion: false,
    generation: 1,
    multiplier: 1,
    remainingMinutes: 12,
  };
}

describe('Tokyo Metro 13000 LCD pair', () => {
  it('uses two 1280x720 panels with a 32px mullion', () => {
    expect([HIBIYA_LCD_WIDTH, HIBIYA_LCD_HEIGHT]).toEqual([2592, 720]);
    expect([HIBIYA_PANEL_WIDTH, HIBIYA_PANEL_HEIGHT, HIBIYA_MULLION_WIDTH]).toEqual([
      1280, 720, 32,
    ]);
  });

  it('coordinates the English/Japanese pair on the documented 4/9/14 second flip clock', () => {
    const config = { line: hibiya, languages: ['ja', 'en'] };
    const before = scheduleHibiyaPair(snapshot(), config, 3_999);
    expect([before.left.page, before.right.page]).toEqual(['broad', 'broad']);
    expect([before.left.language, before.right.language]).toEqual(['en', 'ja']);
    expect(before.left.languages).toEqual(['ja', 'kana', 'en']);
    expect(before.left.languageDeadline).toBe(4_000);
    expect(before.left.pageDeadline).toBe(before.right.pageDeadline);
    expect(before.left.snapshot.progress).toBe(before.right.snapshot.progress);

    const after = scheduleHibiyaPair(snapshot(), config, 4_000);
    expect([after.left.language, after.right.language]).toEqual(['ja', 'kana']);
    expect(after.left.languageDeadline).toBe(4_700);
    expect(scheduleHibiyaPair(snapshot(), config, 4_700).left.languageDeadline).toBe(9_000);
    expect(scheduleHibiyaPair(snapshot(), config, 9_000).left.language).toBe('kana');
    expect(scheduleHibiyaPair(snapshot(), config, 14_000).left.language).toBe('en');
    expect(scheduleHibiyaPair(snapshot(), config, 19_000).left.language).toBe('ja');
    const oneLanguage = scheduleHibiyaPair(snapshot(), { line: hibiya, languages: ['ja'] }, 6_000);
    expect(oneLanguage.left.language).toBe(oneLanguage.right.language);
    expect(oneLanguage.left.languageDeadline).toBeNull();
  });

  it.each([4_000, 9_000, 14_000])(
    'runs a continuous 700ms flip at %dms without a boundary jump',
    (start) => {
      const languages = ['ja', 'kana', 'en'] as const;
      const before = hibiyaLanguageFrame(languages, start - 1);
      const beginning = hibiyaLanguageFrame(languages, start);
      const middle = hibiyaLanguageFrame(languages, start + 350);
      const end = hibiyaLanguageFrame(languages, start + HIBIYA_FLIP_MS);
      expect(beginning.from).toBe(before.to);
      expect(beginning.progress).toBe(0);
      expect(middle.progress).toBe(0.5);
      expect(middle.animating).toBe(true);
      expect(end.progress).toBe(1);
      expect(end.to).toBe(beginning.to);
      expect(end.animating).toBe(false);
    },
  );

  it('matches the H06..H21 reference window for next Ginza, with eight stops per panel', () => {
    const model = scheduleHibiyaPair(snapshot('H08'), { line: hibiya }, 0).left;
    const route = hibiyaRouteWindow(model);
    expect(route[0].code).toBe('H06');
    expect(route[3].code).toBe('H09');
    expect(hibiyaPanelStations(route, 0).at(-1)?.code).toBe('H13');
    expect(hibiyaPanelStations(route, 1)[0].code).toBe('H14');
    expect(route.at(-1)?.code).toBe('H21');
  });

  it('keeps frames coming between language triggers and passes the visible clock through animation', () => {
    const text: string[] = [],
      scales: number[][] = [];
    const target = {
      measureText: (value: string) => ({ width: value.length * 20 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillText: (value: string) => text.push(value),
      scale: (...values: number[]) => scales.push(values),
    };
    const ctx = new Proxy(target, {
      get: (object, key) => (key in object ? object[key as keyof typeof object] : () => {}),
    }) as unknown as CanvasRenderingContext2D;
    const renderer = createHibiyaRenderer();
    const pair = scheduleHibiyaPair(snapshot('H08'), { line: hibiya, manualView: 'map' }, 0);
    expect(renderer.draw(ctx, 2592, 720, pair, 100)).toBe(true);
    text.length = 0;
    expect(renderer.draw(ctx, 2592, 720, pair, 4_450)).toBe(true);
    expect(scales).toContainEqual([1, 0.5]);
    expect(text).toContain('Ginza');
    expect(text).toContain('銀座');
    renderer.dispose();
    expect(renderer.cacheSize).toBe(0);
  });

  it.each([null, 'this side', 'opposite side', 'both sides'] as const)(
    'keeps %s door guidance consistent with the indicated side',
    (sideLabel) => {
      const text: string[] = [],
        arrowScales: number[] = [];
      const target = {
        measureText: (value: string) => ({ width: value.length * 20 }),
        createLinearGradient: () => ({ addColorStop() {} }),
        fillText: (value: string) => text.push(value),
        scale: (x: number, y: number) => {
          if (y === 1 && Math.abs(x) === 1) arrowScales.push(x);
        },
      };
      const ctx = new Proxy(target, {
        get: (object, key) => (key in object ? object[key as keyof typeof object] : () => {}),
      }) as unknown as CanvasRenderingContext2D;
      const base = scheduleHibiyaPair(
        { ...snapshot('H08'), state: 'approaching' },
        { line: hibiya, languages: ['ja'] },
        0,
      );
      const pair = { ...base, right: { ...base.right, sideLabel } };
      const renderer = createHibiyaRenderer();
      renderer.draw(ctx, 2592, 720, pair);
      expect(arrowScales).toEqual(
        sideLabel === 'this side' || sideLabel === 'both sides' ? [1, 1, -1] : [1],
      );
      expect(
        text.some((value) =>
          value.includes(
            sideLabel === 'opposite side'
              ? 'Doors on the opposite side'
              : sideLabel === 'this side'
                ? 'Doors on this side'
                : sideLabel === 'both sides'
                  ? 'Doors on both sides'
                  : 'Please take care around the doors',
          ),
        ),
      ).toBe(true);
      expect(text).not.toContain('出口');
      renderer.dispose();
    },
  );

  it.each(['emergency', 'suspended'] as const)(
    'keeps configured header languages and shows the %s caption instead of Next',
    (state) => {
      const text: { value: string; y: number }[] = [];
      const target = {
        measureText: (value: string) => ({ width: value.length * 20 }),
        createLinearGradient: () => ({ addColorStop() {} }),
        fillText: (value: string, _x: number, y: number) => text.push({ value, y }),
      };
      const ctx = new Proxy(target, {
        get: (object, key) => (key in object ? object[key as keyof typeof object] : () => {}),
      }) as unknown as CanvasRenderingContext2D;
      const pair = scheduleHibiyaPair(
        { ...snapshot('H08'), state },
        { line: hibiya, languages: ['ja', 'en'] },
        0,
      );
      expect(pair.left.languages).toEqual(['ja', 'kana', 'en']);
      expect([pair.left.language, pair.right.language]).toEqual(['en', 'ja']);
      const renderer = createHibiyaRenderer();
      renderer.draw(ctx, 2592, 720, pair);
      const headers = text.filter((item) => item.y < 224).map((item) => item.value);
      expect(headers).toContain(state === 'emergency' ? 'Emergency stop' : 'Service suspended');
      expect(headers).toContain(state === 'emergency' ? '緊急停止' : '運転見合わせ');
      for (const caption of ['Next', 'つぎは', '下一站']) expect(headers).not.toContain(caption);
      expect(text.filter((item) => item.y >= 224).map((item) => item.value)).toEqual(
        expect.arrayContaining(
          state === 'emergency'
            ? ['緊急停止', 'Emergency stop', '紧急停车', '비상 정차']
            : ['運転見合わせ', 'Service suspended', '暂停服务', '운행 중단'],
        ),
      );
      renderer.dispose();
    },
  );

  it('windows route stops in order without duplicate seam stations or invented terminal stops', () => {
    for (const direction of hibiya.directions) {
      for (const station of hibiya.stations) {
        const model = scheduleHibiyaPair(
          snapshot(station.code, direction.id),
          { line: hibiya, languages: ['ja'] },
          0,
        ).left;
        const window = hibiyaRouteWindow(model);
        const left = hibiyaPanelStations(window, 0);
        const right = hibiyaPanelStations(window, 1);
        const shown = [...left, ...right];
        const codes = shown.map((item) => item.code);
        expect(left.length).toBeLessThanOrEqual(8);
        expect(right.length).toBeLessThanOrEqual(8);
        expect(codes).toHaveLength(16);
        expect(codes).toContain(station.code);
        expect(new Set(codes).size).toBe(codes.length);
        const ordered = direction.delta > 0 ? [...hibiya.stations] : [...hibiya.stations].reverse();
        const currentIndex = ordered.findIndex((item) => item.code === station.code);
        const start = Math.max(0, Math.min(currentIndex - 2, ordered.length - 16));
        expect(codes).toEqual(ordered.slice(start, start + 16).map((item) => item.code));
        expect(model.route.at(-1)?.code).toBe(
          direction.delta > 0 ? hibiya.stations.at(-1)?.code : hibiya.stations[0].code,
        );
      }
    }
  });
});

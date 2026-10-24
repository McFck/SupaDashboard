import type { LineDefinition } from './lines';

export const SUBWAY_LINE_IDS = ['yamanote', 'hibiya', 'sakaisuji'] as const;
export type SubwayLineId = typeof SUBWAY_LINE_IDS[number];
export const DISPLAY_LANGUAGE_PRESETS = ['ja-en', 'ja-kana', 'ja-zh', 'ja-ko'] as const;
export const ANNOUNCEMENT_LANGUAGE_PRESETS = ['ja', 'en', 'ja-en'] as const;
export const SUBWAY_DEFAULT_CONFIG = Object.freeze({
  line: 'yamanote', direction: 'inner', startStation: 'JY01', speed: 1,
  displayLanguages: 'ja-en', announcementLanguages: 'ja-en', immersion: false, announcementVolume: 0.8,
  gesture: 'tripleTap', corner: 'bottomRight',
});

export type NormalizedSubwayConfig = Readonly<Record<string, unknown> & {
  line: SubwayLineId; direction: string; startStation: string; speed: 0.5 | 1 | 2;
  displayLanguages: string; announcementLanguages: string; immersion: boolean; announcementVolume: number;
  gesture: 'tripleTap' | 'cornerHold' | 'off'; corner: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
}>;

const lineIds = new Set<string>(SUBWAY_LINE_IDS);
const displayPresets = new Set<string>(DISPLAY_LANGUAGE_PRESETS);
const announcementPresets = new Set<string>(ANNOUNCEMENT_LANGUAGE_PRESETS);
const supportedDisplay = (line: LineDefinition, preset: string) => {
  if (line.id === 'yamanote' && preset !== 'ja-en') return false;
  if (line.id === 'hibiya' && preset === 'ja-kana') return false;
  if (line.id === 'sakaisuji' && preset !== 'ja-kana') return false;
  const languages = displayLanguages(preset);
  if (!languages.length || languages.some(language => !line.stations.some(station => station.names[language]))) return false;
  return line.id !== 'sakaisuji' || languages.every(language => language === 'ja' || language === 'kana');
};

export function displayLanguages(preset: string): string[] {
  if (preset === 'ja-en') return ['ja', 'en'];
  if (preset === 'ja-kana') return ['ja', 'kana'];
  if (preset === 'ja-zh') return ['ja', 'zh'];
  if (preset === 'ja-ko') return ['ja', 'ko'];
  return [];
}

export function announcementLanguages(preset: string): string[] {
  return preset === 'ja' ? ['ja'] : preset === 'en' ? ['en'] : preset === 'ja-en' ? ['ja', 'en'] : [];
}

export function firstStationForDirection(line: LineDefinition, directionId: string): string {
  const direction = line.directions.find(item => item.id === directionId) ?? line.directions[0];
  return direction.delta === -1 ? line.stations.at(-1)!.code : line.stations[0].code;
}

/** Validate dependent settings at the runtime boundary while retaining unrelated saved keys. */
export function normalizeSubwayConfig(
  stored: Readonly<Record<string, unknown>>,
  lines: readonly LineDefinition[],
): NormalizedSubwayConfig {
  const fallbackLine = lines.find(line => line.id === SUBWAY_DEFAULT_CONFIG.line) ?? lines[0];
  if (!fallbackLine) throw new Error('Subway has no normalized line data');
  const requestedLine = stored.line;
  const line = lineIds.has(String(requestedLine)) ? lines.find(item => item.id === requestedLine) ?? fallbackLine : fallbackLine;
  const requestedDirection = stored.direction;
  const direction = typeof requestedDirection === 'string' && line.directions.some(item => item.id === requestedDirection)
    ? requestedDirection : line.directions[0].id;
  const requestedStation = typeof stored.startStation === 'string' ? stored.startStation : stored.station;
  const startStation = typeof requestedStation === 'string' && line.stations.some(item => item.code === requestedStation)
    ? requestedStation : firstStationForDirection(line, direction);
  const requestedSpeed = typeof stored.speed === 'string' && stored.speed.trim() ? Number(stored.speed) : stored.speed;
  const speed: 0.5 | 1 | 2 = requestedSpeed === 0.5 || requestedSpeed === 2 ? requestedSpeed : 1;
  const displayCandidate = typeof stored.displayLanguages === 'string' && displayPresets.has(stored.displayLanguages)
    ? stored.displayLanguages : line.id === 'sakaisuji' ? 'ja-kana' : 'ja-en';
  const display = supportedDisplay(line, displayCandidate) ? displayCandidate : line.id === 'sakaisuji' ? 'ja-kana' : 'ja-en';
  const announcementCandidate = typeof stored.announcementLanguages === 'string' && announcementPresets.has(stored.announcementLanguages)
    ? stored.announcementLanguages : 'ja-en';
  const volume = typeof stored.announcementVolume === 'number' && Number.isFinite(stored.announcementVolume)
    ? Math.min(1, Math.max(0, stored.announcementVolume)) : 0.8;
  const gesture = stored.gesture === 'cornerHold' || stored.gesture === 'off' ? stored.gesture : 'tripleTap';
  const corner = stored.corner === 'topLeft' || stored.corner === 'topRight' || stored.corner === 'bottomLeft'
    ? stored.corner : 'bottomRight';
  return Object.freeze({ ...stored, line: line.id, direction, startStation, speed, displayLanguages: display,
    announcementLanguages: announcementCandidate, immersion: typeof stored.immersion === 'boolean' ? stored.immersion : false,
    announcementVolume: volume, gesture, corner }) as NormalizedSubwayConfig;
}


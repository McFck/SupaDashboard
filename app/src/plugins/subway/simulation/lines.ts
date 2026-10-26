import { buildDirectionDetails, transferSupplements, type SideEvidence } from './station-details';

export type LocalizedNames = Readonly<Record<string, string>>;

export interface LineDirection {
  id: string;
  delta: 1 | -1;
  names: LocalizedNames;
}

export type StationTransfer =
  | { kind: 'badge'; code: string; source: string; revision?: string }
  | { kind: 'text'; names: LocalizedNames; source: string; revision?: string };

export interface StationDefinition {
  id: string;
  code: string;
  order: number;
  abbr?: string;
  names: LocalizedNames;
  coordinates?: Readonly<{ lat: number; lon: number }>;
  transfers: readonly StationTransfer[];
  doorByDirection: Readonly<Record<string, ReturnType<typeof buildDirectionDetails>['doorByDirection'][string]>>;
  platformByDirection: Readonly<Record<string, ReturnType<typeof buildDirectionDetails>['platformByDirection'][string]>>;
}

export interface LineDefinition {
  id: 'yamanote' | 'hibiya' | 'sakaisuji';
  code: 'JY' | 'H' | 'K';
  order: number;
  names: LocalizedNames;
  color: string;
  loop: boolean;
  carCount: 11 | 7 | 8;
  directions: readonly LineDirection[];
  stations: readonly StationDefinition[];
}

export interface RawLineBundle {
  line: unknown;
  pack: unknown;
}

const LINE_ORDER = ['yamanote', 'hibiya', 'sakaisuji'] as const;
const LINE_CODE: Record<LineDefinition['id'], LineDefinition['code']> = {
  yamanote: 'JY', hibiya: 'H', sakaisuji: 'K',
};
const CAR_COUNT: Record<LineDefinition['id'], LineDefinition['carCount']> = {
  yamanote: 11, hibiya: 7, sakaisuji: 8,
};
const DIRECTION_SPECS: Record<LineDefinition['id'], readonly { id: string; delta: 1 | -1 }[]> = {
  yamanote: [{ id: 'inner', delta: 1 }, { id: 'outer', delta: -1 }],
  hibiya: [{ id: 'to-kita-senju', delta: 1 }, { id: 'to-naka-meguro', delta: -1 }],
  sakaisuji: [{ id: 'southbound', delta: 1 }, { id: 'northbound', delta: -1 }],
};
const CODE_PATTERN = /^[A-Z]{1,3}\d{2}$/;
const COLOR_PATTERN = /^#[\da-f]{6}$/i;
const TRANSFER_CODE_PATTERN = /^[A-Z]{1,3}\d{2}$/;

type RawRecord = Record<string, unknown>;

function record(value: unknown, label: string): RawRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as RawRecord;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function localizedNames(value: unknown, label: string): LocalizedNames {
  const source = record(value, label);
  const names: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) continue;
    const key = rawKey.toLowerCase() === 'jp' ? 'ja' : rawKey.toLowerCase();
    names[key] ??= rawValue.trim();
  }
  return Object.freeze(names);
}

function requiredNames(value: unknown, label: string): LocalizedNames {
  const names = localizedNames(value, label);
  if (!names.ja || !names.en) throw new Error(`${label} requires Japanese and English names`);
  return names;
}

function isDirection(value: unknown): value is 'left' | 'right' | 'both' {
  return value === 'left' || value === 'right' || value === 'both';
}

function sideEvidenceFor(value: unknown, validDirections: ReadonlySet<string>): SideEvidence[] {
  const evidence: SideEvidence[] = [];
  const seen = new Set<string>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    const source = item as RawRecord;
    // `directions` means a clip may be reused there; only its explicit `direction`
    // ties the side evidence to one platform direction.
    if (typeof source.direction === 'string' && validDirections.has(source.direction) && isDirection(source.side)) {
      const sourceName = typeof source.source === 'string' && source.source.trim() ? source.source.trim() : 'pack.json';
      const key = `${source.direction}\0${source.side}\0${sourceName}`;
      if (!seen.has(key)) {
        seen.add(key);
        evidence.push({ direction: source.direction, side: source.side, source: `pack.json:${sourceName}` });
      }
    }
    Object.values(source).forEach(visit);
  };
  visit(value);
  return evidence;
}

function directionNames(
  lineId: LineDefinition['id'],
  directionId: string,
  rawLineDirections: RawRecord | undefined,
  rawPackDirections: RawRecord | undefined,
  stations: readonly StationDefinition[],
): LocalizedNames {
  const lineLabel = rawLineDirections?.[directionId];
  const packLabel = rawPackDirections?.[directionId];
  const endpointJa = (code: string) => stations.find(station => station.code === code)?.names.ja;
  if (lineId === 'yamanote') {
    const label = nonEmpty(lineLabel ?? packLabel, `Direction ${directionId} label`);
    return Object.freeze({ ja: label, en: directionId === 'inner' ? 'Inner loop' : 'Outer loop' });
  }
  if (lineId === 'hibiya') {
    const targetCode = directionId === 'to-kita-senju' ? 'H22' : 'H01';
    return Object.freeze({
      en: nonEmpty(packLabel ?? lineLabel, `Direction ${directionId} label`),
      ja: `${endpointJa(targetCode)}方面`,
    });
  }
  const targetCode = directionId === 'northbound' ? 'K11' : 'K20';
  return Object.freeze({
    en: nonEmpty(packLabel ?? lineLabel, `Direction ${directionId} label`),
    ja: `${endpointJa(targetCode)}方面`,
  });
}

function stationTransfers(
  lineId: LineDefinition['id'],
  code: string,
  rawStation: RawRecord,
  rawTransfers: RawRecord | undefined,
): readonly StationTransfer[] {
  const result: StationTransfer[] = [];
  const seenCodes = new Set<string>();
  const addCode = (value: unknown, source: string, revision?: string): void => {
    const transferCode = nonEmpty(value, `Transfer code at ${code}`);
    if (!TRANSFER_CODE_PATTERN.test(transferCode)) throw new Error(`Invalid transfer code at ${code}: ${transferCode}`);
    if (seenCodes.has(transferCode)) return;
    seenCodes.add(transferCode);
    result.push(Object.freeze({ kind: 'badge', code: transferCode, source, ...(revision ? { revision } : {}) }));
  };
  const addText = (value: unknown, source: string, revision?: string): void => {
    const names = localizedNames(value, `Transfer text at ${code}`);
    if (!Object.keys(names).length) return;
    result.push(Object.freeze({ kind: 'text', names, source, ...(revision ? { revision } : {}) }));
  };

  if (rawStation.transferCodes !== undefined && !Array.isArray(rawStation.transferCodes)) {
    throw new Error(`Transfer codes at ${code} must be an array`);
  }
  for (const transferCode of (rawStation.transferCodes as unknown[] | undefined) ?? []) addCode(transferCode, 'line.json');
  const rawText = rawTransfers?.[code];
  if (rawText !== undefined) addText(rawText, 'line.json');

  const supplement = transferSupplements[lineId]?.[code];
  if (supplement?.codes) for (const transferCode of supplement.codes) addCode(transferCode, supplement.source, supplement.revision);
  if (supplement?.text) addText(supplement.text, supplement.source, supplement.revision);
  return Object.freeze(result);
}

export function normalizeSubwayLine(rawLine: unknown, rawPack: unknown): LineDefinition {
  const line = record(rawLine, 'Line definition');
  const pack = record(rawPack, 'Line sound pack');
  const id = nonEmpty(line.id, 'Line id');
  if (!LINE_ORDER.includes(id as LineDefinition['id'])) throw new Error(`Unknown Subway line: ${id}`);
  const lineId = id as LineDefinition['id'];
  if (pack.id !== lineId) throw new Error(`Line and sound pack ids differ: ${lineId} / ${String(pack.id)}`);

  const name = requiredNames(line.name, `Line ${lineId} name`);
  const color = nonEmpty(line.color, `Line ${lineId} color`);
  if (!COLOR_PATTERN.test(color)) throw new Error(`Invalid line color: ${color}`);
  if (typeof line.loop !== 'boolean') throw new Error(`Line ${lineId} loop flag must be boolean`);
  if (line.loop !== (lineId === 'yamanote')) throw new Error(`Unexpected loop flag for ${lineId}`);

  const rawStations = line.stations;
  const packStations = pack.stations;
  if (!Array.isArray(rawStations) || !rawStations.length) throw new Error(`Line ${lineId} stations must be a non-empty array`);
  if (!Array.isArray(packStations) || packStations.length !== rawStations.length) {
    throw new Error(`Line ${lineId} and pack station counts differ`);
  }
  const expectedCode = LINE_CODE[lineId];
  const seenCodes = new Set<string>();
  const firstCode = nonEmpty(record(rawStations[0], `Line ${lineId} station 1`).code, 'Station code');
  if (!CODE_PATTERN.test(firstCode) || !firstCode.startsWith(expectedCode)) throw new Error(`Invalid station code for ${lineId}: ${firstCode}`);

  const rawTransfers = line.transfers === undefined ? undefined : record(line.transfers, `Line ${lineId} transfers`);
  const rawLineDirections = line.directions === undefined ? undefined : record(line.directions, `Line ${lineId} directions`);
  const rawPackDirections = pack.directions === undefined ? undefined : record(pack.directions, `Pack ${lineId} directions`);
  const directionSpecs = DIRECTION_SPECS[lineId];
  const directionIds = directionSpecs.map(direction => direction.id);
  for (const labels of [rawLineDirections, rawPackDirections]) {
    if (!labels) continue;
    const keys = Object.keys(labels);
    if (keys.length !== directionIds.length || directionIds.some(direction => !Object.hasOwn(labels, direction))) {
      throw new Error(`Invalid direction keys for ${lineId}`);
    }
  }
  if (!rawLineDirections && !rawPackDirections) throw new Error(`Line ${lineId} has no direction labels`);

  const stationRecords = rawStations.map((item, order) => {
    const rawStation = record(item, `Line ${lineId} station ${order + 1}`);
    const code = nonEmpty(rawStation.code, `Line ${lineId} station code`);
    if (!CODE_PATTERN.test(code) || !code.startsWith(expectedCode)) throw new Error(`Invalid station code for ${lineId}: ${code}`);
    if (seenCodes.has(code)) throw new Error(`Duplicate station code: ${code}`);
    seenCodes.add(code);

    const rawPackStation = record(packStations[order], `Pack ${lineId} station ${order + 1}`);
    if (rawPackStation.code !== code) throw new Error(`Pack station order mismatch at ${lineId} ${code}`);
    const names = requiredNames({
      ja: rawStation.kanji ?? rawStation.name,
      en: rawStation.romaji ?? rawStation.name,
      kana: rawStation.kana,
      zh: rawStation.zh,
      ko: rawStation.ko,
    }, `Station ${code} name`);

    let coordinates: Readonly<{ lat: number; lon: number }> | undefined;
    const hasLat = rawStation.lat !== undefined;
    const hasLon = rawStation.lon !== undefined;
    if (hasLat !== hasLon) throw new Error(`Station ${code} has incomplete coordinates`);
    if (hasLat && hasLon) {
      const lat = rawStation.lat;
      const lon = rawStation.lon;
      if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
          typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
        throw new Error(`Station ${code} has invalid coordinates`);
      }
      coordinates = Object.freeze({ lat, lon });
    }

    const details = buildDirectionDetails(
      directionIds,
      CAR_COUNT[lineId],
      sideEvidenceFor(rawPackStation, new Set(directionIds)),
    );
    return Object.freeze({
      id: code,
      code,
      order,
      ...(typeof rawStation.abbr === 'string' && rawStation.abbr.trim() ? { abbr: rawStation.abbr.trim() } : {}),
      names,
      ...(coordinates ? { coordinates } : {}),
      transfers: stationTransfers(lineId, code, rawStation, rawTransfers),
      doorByDirection: details.doorByDirection,
      platformByDirection: details.platformByDirection,
    });
  });

  if (rawTransfers) {
    for (const code of Object.keys(rawTransfers)) {
      if (!seenCodes.has(code)) throw new Error(`Transfer prose references unknown station: ${code}`);
    }
  }

  const directions = Object.freeze(directionSpecs.map(spec => Object.freeze({
    id: spec.id,
    delta: spec.delta,
    names: directionNames(lineId, spec.id, rawLineDirections, rawPackDirections, stationRecords),
  })));
  return Object.freeze({
    id: lineId,
    code: expectedCode,
    order: LINE_ORDER.indexOf(lineId),
    names: name,
    color,
    loop: line.loop,
    carCount: CAR_COUNT[lineId],
    directions,
    stations: Object.freeze(stationRecords),
  });
}

export function normalizeSubwayLines(
  bundles: readonly RawLineBundle[] | Readonly<Record<string, RawLineBundle>>,
): readonly LineDefinition[] {
  const entries = Array.isArray(bundles) ? bundles : Object.values(bundles);
  const byId = new Map<string, LineDefinition>();
  for (const bundle of entries) {
    const definition = normalizeSubwayLine(bundle.line, bundle.pack);
    if (byId.has(definition.id)) throw new Error(`Duplicate Subway line: ${definition.id}`);
    byId.set(definition.id, definition);
  }
  if (byId.size !== LINE_ORDER.length || LINE_ORDER.some(id => !byId.has(id))) {
    throw new Error(`Subway line catalog must contain ${LINE_ORDER.join(', ')}`);
  }
  return Object.freeze(LINE_ORDER.map(id => byId.get(id)!));
}

export function localizedName(names: LocalizedNames, language: string, fallback = ''): string {
  const key = typeof language === 'string' ? language.toLowerCase() : '';
  return names[key] || names.en || names.ja || fallback;
}

export function stepStation(
  line: LineDefinition,
  stationCode: string,
  directionId: string,
  steps = 1,
): StationDefinition | undefined {
  if (!Number.isInteger(steps) || steps < 1) throw new Error(`Invalid station step count: ${steps}`);
  const currentIndex = line.stations.findIndex(station => station.code === stationCode);
  const direction = line.directions.find(item => item.id === directionId);
  if (currentIndex < 0 || !direction) return undefined;
  const targetIndex = currentIndex + direction.delta * steps;
  if (line.loop) return line.stations[((targetIndex % line.stations.length) + line.stations.length) % line.stations.length];
  return line.stations[targetIndex];
}

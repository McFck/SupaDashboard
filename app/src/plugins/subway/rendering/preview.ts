import { normalizeSubwayLine, type LineDefinition } from '../simulation/lines';
import { createRunState, snapshotRun, type RunSnapshot } from '../simulation/run';
import { e235AssetsReady } from './lcd/e235-pages';

export interface SubwayEditorPreview {
  line: LineDefinition;
  snapshot: Readonly<RunSnapshot>;
  config: Readonly<Record<string, unknown>>;
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`Subway preview asset unavailable (${response.status}): ${url}`);
  return response.json() as Promise<unknown>;
}

function selectedLine(config: Readonly<Record<string, unknown>>): LineDefinition['id'] {
  const candidate = config.line;
  return candidate === 'hibiya' || candidate === 'sakaisuji' ? candidate : 'yamanote';
}

export async function loadSubwayEditorPreview(
  config: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<SubwayEditorPreview> {
  const lineId = selectedLine(config);
  const base = `/subway/lines/${lineId}`;
  const [rawLine, rawPack] = await Promise.all([
    readJson(`${base}/line.json`, signal),
    readJson(`${base}/pack.json`, signal),
    lineId === 'yamanote' ? e235AssetsReady : Promise.resolve(),
  ]);
  if (signal.aborted) throw new DOMException('Subway preview cancelled', 'AbortError');
  const line = normalizeSubwayLine(rawLine, rawPack);
  const direction =
    typeof config.direction === 'string' &&
    line.directions.some((item) => item.id === config.direction)
      ? config.direction
      : line.directions[0].id;
  const requestedStation =
    typeof config.startStation === 'string' ? config.startStation : config.station;
  const stationCode =
    typeof requestedStation === 'string' &&
    line.stations.some((item) => item.code === requestedStation)
      ? requestedStation
      : line.stations[0].code;
  const state = createRunState([line], {
    lineId,
    stationCode,
    direction,
    immersion: false,
    now: 0,
  });
  return Object.freeze({
    line,
    snapshot: Object.freeze(snapshotRun(state, 0, [line])),
    config: Object.freeze({ ...config }),
  });
}

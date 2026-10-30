import { firstStationForDirection } from './config';
import type { LineDefinition } from './lines';
import type { SubwayRunState } from './run-state';

export interface LineRequest {
  line: LineDefinition;
  direction: string;
  stationCode: string;
  /** Which parts the caller named explicitly, so later settings changes do not override them. */
  named: { direction: boolean; station: boolean };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Resolves an action's line/direction/startStation arguments against the current run; undefined if invalid. */
export function resolveLineRequest(
  lines: readonly LineDefinition[],
  state: SubwayRunState,
  args: { line?: unknown; direction?: unknown; startStation?: unknown },
): LineRequest | undefined {
  const currentLine = lines.find((item) => item.id === state.lineId)!;
  const requestedLine = text(args.line);
  const line =
    requestedLine === undefined
      ? lines[(lines.findIndex((item) => item.id === currentLine.id) + 1) % lines.length]
      : lines.find((item) => item.id === requestedLine);
  if (!line) return undefined;
  const requestedDirection = text(args.direction);
  const direction =
    requestedDirection ??
    (line.id === currentLine.id && line.directions.some((item) => item.id === state.direction)
      ? state.direction
      : line.directions[0].id);
  if (!line.directions.some((item) => item.id === direction)) return undefined;
  const requestedStation = text(args.startStation);
  const stationCode =
    requestedStation ??
    (line.id === currentLine.id && line.stations.some((item) => item.code === state.stationCode)
      ? state.stationCode
      : firstStationForDirection(line, direction));
  if (!line.stations.some((item) => item.code === stationCode)) return undefined;
  return {
    line,
    direction,
    stationCode,
    named: {
      direction: requestedDirection !== undefined,
      station: requestedStation !== undefined || line.id !== currentLine.id,
    },
  };
}

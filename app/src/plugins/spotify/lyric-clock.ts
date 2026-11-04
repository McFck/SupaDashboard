// Which lyric line is being sung: the player's extrapolated position against the LRC timestamps.
import { isRecord } from '../../features/automation/plain-data';
import { progressAt } from '../../features/media/now-playing';
import type { NowPlayingSession } from '../../features/plugins/contracts';
import type { LyricLine } from '../../platform/lyrics';

/** A line lights this early (ms), so the highlight lands as the singer starts rather than after. */
const LEAD_MS = 150;
export const OFFSET_LIMIT_MS = 2000;
export const OFFSET_STEP_MS = 50;

/** The tile's sync offset in ms; positive shows lines earlier. Anything unusable reads as 0. */
export function offsetOf(options: unknown) {
  const value = isRecord(options) ? options.offsetMs : undefined;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, value))
    : 0;
}

/** Milliseconds into the track at `nowMs`, shifted by `offsetMs`, or null when the player gives no timing. */
export function positionAt(session: NowPlayingSession, nowMs: number, offsetMs: number) {
  const progress = progressAt(session, nowMs);
  const timeline = session.timeline;
  return progress === null || !timeline
    ? null
    : progress * (timeline.endMs - timeline.startMs) + offsetMs;
}

/** Index of the line sung at `positionMs` (sorted lines), or -1 before the first one. */
export function lineAt(lines: readonly LyricLine[], positionMs: number) {
  const at = positionMs + LEAD_MS;
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lines[middle].atMs <= at) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
}

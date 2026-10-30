import type { RunSegment, SubwayRunState } from './run-state';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function segmentProgress(segment: RunSegment, at: number): number {
  const elapsed = Math.max(0, at - segment.startedAt);
  const dep = segment.departureMs;
  const cruise = segment.cruiseMs;
  const approach = segment.approachMs;
  const totalArea = (dep + approach) * 0.5 + cruise;
  let area: number;
  if (elapsed < dep) area = (0.5 * elapsed * elapsed) / dep;
  else if (elapsed < dep + cruise) area = dep * 0.5 + elapsed - dep;
  else if (elapsed < dep + cruise + approach) {
    const intoApproach = elapsed - dep - cruise;
    area = dep * 0.5 + cruise + intoApproach - (0.5 * intoApproach * intoApproach) / approach;
  } else area = totalArea;
  return clamp(segment.baseProgress + ((1 - segment.baseProgress) * area) / totalArea, 0, 1);
}

function segmentSpeed(segment: RunSegment, at: number): number {
  const elapsed = Math.max(0, at - segment.startedAt);
  const maxSpeed = 60;
  if (elapsed < segment.departureMs) return (maxSpeed * elapsed) / segment.departureMs;
  if (elapsed < segment.departureMs + segment.cruiseMs) return maxSpeed;
  if (elapsed < segment.departureMs + segment.cruiseMs + segment.approachMs)
    return maxSpeed * (1 - (elapsed - segment.departureMs - segment.cruiseMs) / segment.approachMs);
  return 0;
}

export function activeNow(state: SubwayRunState, now: number): number {
  return state.pausedAt ?? now;
}

export function snapshotMotion(
  state: SubwayRunState,
  now: number,
): { speed: number; progress: number } {
  const at = activeNow(state, now);
  if (state.incident) {
    const elapsed = clamp(at - state.incident.startedAt, 0, state.incident.brakeMs);
    const fraction = state.incident.brakeMs ? elapsed / state.incident.brakeMs : 1;
    const speed = state.incident.speedAtStart * (1 - fraction);
    const brakingArea =
      (state.incident.speedAtStart / 60) *
      state.incident.brakeMs *
      (fraction - 0.5 * fraction * fraction);
    const segment = state.incident.resume.segment;
    const totalArea = segment
      ? (segment.departureMs + segment.approachMs) * 0.5 + segment.cruiseMs
      : 1;
    const progress = segment
      ? clamp(state.incident.progressAtStart + brakingArea / totalArea, 0, 1)
      : 0;
    return { speed, progress };
  }
  if (!state.segment || !['departing', 'cruising', 'approaching'].includes(state.phase))
    return { speed: 0, progress: state.segment?.baseProgress ?? 0 };
  return { speed: segmentSpeed(state.segment, at), progress: segmentProgress(state.segment, at) };
}

import type { DoorSequencePlan, ResolvedCue, SegmentCuePlan, TimedCue } from './sound-pack';
import { stepStation, type LineDefinition } from './lines';

export type { SegmentCuePlan, TimedCue } from './sound-pack';

export type RunPhase = 'stopped' | 'doorsClosing' | 'departing' | 'cruising' | 'approaching' | 'arriving' | 'emergency' | 'suspended';
export type DoorPhase = 'closed' | 'opening' | 'open' | 'closing';
export type IncidentKind = 'emergency' | 'suspended';

export type SubwayCuePlans = Readonly<Record<string, SegmentCuePlan>>;

export function segmentPlanKey(lineId: string, from: string, to: string, direction: string): string {
  return `${lineId}|${from}|${to}|${direction}`;
}

export interface RunSegment {
  from: string;
  to: string;
  direction: string;
  planKey: string;
  multiplier: number;
  startedAt: number;
  departureMs: number;
  cruiseMs: number;
  approachMs: number;
  baseProgress: number;
  departed: boolean;
}

export interface ScheduledCue extends TimedCue {
  at: number;
  id: string;
}

export interface RunTimeline {
  phase: RunPhase;
  doors: DoorPhase;
  active: boolean;
  stationCode: string;
  phaseStartedAt: number | null;
  phaseDeadline: number | null;
  stopDeadline: number | null;
  segment: RunSegment | null;
  pendingCues: readonly ScheduledCue[];
  loopArrivalsRemaining: number;
}

export interface RunIncident {
  kind: IncidentKind;
  startedAt: number;
  brakeMs: number;
  speedAtStart: number;
  progressAtStart: number;
  doorsBefore: DoorPhase;
  resume: RunTimeline;
}

export interface SubwayRunState extends RunTimeline {
  lineId: LineDefinition['id'];
  direction: string;
  multiplier: number;
  nextMultiplier: number;
  dwellSeconds: number;
  generation: number;
  immersion: boolean;
  pausedAt: number | null;
  lastTickAt: number;
  incident: RunIncident | null;
}

export type RunCommand =
  | { type: 'start' }
  | { type: 'set-line'; lineId: LineDefinition['id']; stationCode?: string }
  | { type: 'set-direction'; direction: string }
  | { type: 'reverse' }
  | { type: 'set-speed'; multiplier: number }
  | { type: 'set-immersion'; enabled: boolean }
  | { type: 'emergency' }
  | { type: 'suspend' }
  | { type: 'resume-service' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'tick' };

export type RunEffect =
  | { type: 'play-cue'; id: string; cue: ResolvedCue; generation: number }
  | { type: 'departed'; from: string; to: string; line: string; direction: string; generation: number }
  | { type: 'arrived'; from: string; to: string; line: string; direction: string; generation: number }
  | { type: 'state-changed'; state: RunPhase; generation: number }
  | { type: 'emergency'; generation: number }
  | { type: 'suspended'; generation: number };

export interface RunTransition {
  state: SubwayRunState;
  effects: readonly RunEffect[];
}

export interface RunSnapshot {
  station: string;
  next: string;
  state: RunPhase;
  line: string;
  direction: string;
  doorSide: 'left' | 'right' | 'both' | 'unknown';
  doors: DoorPhase;
  speed: number;
  power: number;
  brake: number;
  progress: number;
  paused: boolean;
  immersion: boolean;
  generation: number;
  multiplier: number;
  remainingMinutes: number;
}

const MAX_GAP_MS = 5_000;
const RELEASE_MS = 600;
const BRAKE_MS = 2_000;
const MIN_SEGMENT_SECONDS = { departure: 12, cruise: 5, approach: 12 } as const;
const EMPTY_DOOR_PLAN: DoorSequencePlan = Object.freeze({ events: [], end: 0 });
const EMPTY_CUE_PLAN: SegmentCuePlan = Object.freeze({ close: EMPTY_DOOR_PLAN, open: EMPTY_DOOR_PLAN, departure: [], arrival: [] });

function lineFor(lines: readonly LineDefinition[], id: string): LineDefinition {
  const line = lines.find(item => item.id === id);
  if (!line) throw new Error(`Unknown Subway line: ${id}`);
  return line;
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function finiteTime(now: number): void {
  if (!Number.isFinite(now)) throw new Error('Subway clock must return a finite time');
}

export function createRunState(
  lines: readonly LineDefinition[],
  options: { lineId?: LineDefinition['id']; stationCode?: string; direction?: string; multiplier?: number; dwellSeconds?: number; immersion?: boolean; now?: number } = {},
): SubwayRunState {
  const now = options.now ?? 0;
  finiteTime(now);
  const line = lineFor(lines, options.lineId ?? 'yamanote');
  const stationCode = options.stationCode ?? line.stations[0]?.code;
  if (!stationCode || !line.stations.some(station => station.code === stationCode)) throw new Error(`Unknown station for ${line.id}: ${stationCode}`);
  const direction = options.direction ?? line.directions[0]?.id;
  if (!direction || !line.directions.some(item => item.id === direction)) throw new Error(`Unknown direction for ${line.id}: ${direction}`);
  const multiplier = options.multiplier ?? 1;
  if (![0.5, 1, 2].includes(multiplier)) throw new Error('Run speed must be 0.5, 1, or 2');
  const dwellSeconds = options.dwellSeconds ?? 15;
  if (!Number.isFinite(dwellSeconds) || dwellSeconds < 0) throw new Error('Dwell must be a non-negative finite duration');
  return {
    lineId: line.id, direction, multiplier, nextMultiplier: multiplier, dwellSeconds,
    phase: 'stopped', doors: 'open', active: false, stationCode, phaseStartedAt: null, phaseDeadline: null,
    stopDeadline: null, segment: null, pendingCues: [], loopArrivalsRemaining: line.loop ? line.stations.length : 0,
    generation: 0, immersion: options.immersion ?? true, pausedAt: null, lastTickAt: now, incident: null,
  };
}

function segmentProgress(segment: RunSegment, at: number): number {
  const elapsed = Math.max(0, at - segment.startedAt);
  const dep = segment.departureMs;
  const cruise = segment.cruiseMs;
  const approach = segment.approachMs;
  const totalArea = (dep + approach) * 0.5 + cruise;
  let area: number;
  if (elapsed < dep) area = 0.5 * elapsed * elapsed / dep;
  else if (elapsed < dep + cruise) area = dep * 0.5 + elapsed - dep;
  else if (elapsed < dep + cruise + approach) {
    const intoApproach = elapsed - dep - cruise;
    area = dep * 0.5 + cruise + intoApproach - 0.5 * intoApproach * intoApproach / approach;
  } else area = totalArea;
  return clamp(segment.baseProgress + (1 - segment.baseProgress) * area / totalArea, 0, 1);
}

function segmentSpeed(segment: RunSegment, at: number): number {
  const elapsed = Math.max(0, at - segment.startedAt);
  const maxSpeed = 60;
  if (elapsed < segment.departureMs) return maxSpeed * elapsed / segment.departureMs;
  if (elapsed < segment.departureMs + segment.cruiseMs) return maxSpeed;
  if (elapsed < segment.departureMs + segment.cruiseMs + segment.approachMs)
    return maxSpeed * (1 - (elapsed - segment.departureMs - segment.cruiseMs) / segment.approachMs);
  return 0;
}

function activeNow(state: SubwayRunState, now: number): number {
  return state.pausedAt ?? now;
}

function snapshotMotion(state: SubwayRunState, now: number): { speed: number; progress: number } {
  const at = activeNow(state, now);
  if (state.incident) {
    const elapsed = clamp(at - state.incident.startedAt, 0, state.incident.brakeMs);
    const fraction = state.incident.brakeMs ? elapsed / state.incident.brakeMs : 1;
    const speed = state.incident.speedAtStart * (1 - fraction);
    const brakingArea = state.incident.speedAtStart / 60 * state.incident.brakeMs * (fraction - 0.5 * fraction * fraction);
    const segment = state.incident.resume.segment;
    const totalArea = segment ? (segment.departureMs + segment.approachMs) * 0.5 + segment.cruiseMs : 1;
    const progress = segment ? clamp(state.incident.progressAtStart + brakingArea / totalArea, 0, 1) : 0;
    return { speed, progress };
  }
  if (!state.segment || !['departing', 'cruising', 'approaching'].includes(state.phase)) return { speed: 0, progress: state.segment?.baseProgress ?? 0 };
  return { speed: segmentSpeed(state.segment, at), progress: segmentProgress(state.segment, at) };
}

function pushPhase(effects: RunEffect[], state: SubwayRunState, phase: RunPhase): void {
  if (state.phase !== phase) effects.push({ type: 'state-changed', state: phase, generation: state.generation });
}

function doorPlan(plan: SegmentCuePlan, kind: 'open' | 'close'): DoorSequencePlan {
  return plan?.[kind] ?? EMPTY_DOOR_PLAN;
}

function validateCue(cue: ResolvedCue, part: string): void {
  if (!cue || !Number.isFinite(cue.duration) || cue.duration <= 0 || !Number.isFinite(cue.audible_end) || cue.audible_end < 0 || cue.audible_end > cue.duration) {
    throw new Error(`Invalid Subway ${part} cue`);
  }
}

function scheduleCues(items: readonly TimedCue[], start: number, idPrefix: string): ScheduledCue[] {
  return items.map((item, index) => {
    if (!Number.isFinite(item.at) || item.at < 0) throw new Error(`Invalid Subway cue time: ${item.part}`);
    validateCue(item.cue, item.part);
    return { ...item, id: `${idPrefix}:${index}:${item.cue.file}`, at: start + item.at * 1000 };
  }).sort((a, b) => a.at - b.at);
}

function scheduleDoorCues(plan: DoorSequencePlan, start: number, idPrefix: string): ScheduledCue[] {
  return scheduleCues(plan.events, start, idPrefix);
}

function cueQueueEnd(items: readonly TimedCue[]): number {
  return items.reduce((end, item) => {
    validateCue(item.cue, item.part);
    if (!Number.isFinite(item.at) || item.at < 0) throw new Error(`Invalid Subway cue time: ${item.part}`);
    return Math.max(end, item.at + item.cue.duration);
  }, 0);
}

function validateDoorPlan(plan: DoorSequencePlan, action: string): void {
  if (!plan || !Number.isFinite(plan.end) || plan.end < 0) throw new Error(`Invalid Subway ${action} plan`);
  for (const event of plan.events) {
    if (!Number.isFinite(event.at) || event.at < 0) throw new Error(`Invalid Subway ${action} cue time`);
    validateCue(event.cue, event.part);
  }
  for (const value of [plan.open_end, plan.close_end, plan.departure_melody_end]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`Invalid Subway ${action} anchor`);
  }
}

function copyTimeline(state: SubwayRunState): RunTimeline {
  return {
    phase: state.phase, doors: state.doors, active: state.active, stationCode: state.stationCode,
    phaseStartedAt: state.phaseStartedAt, phaseDeadline: state.phaseDeadline, stopDeadline: state.stopDeadline,
    segment: state.segment ? { ...state.segment } : null, pendingCues: [...state.pendingCues],
    loopArrivalsRemaining: state.loopArrivalsRemaining,
  };
}

function installTimeline(state: SubwayRunState, timeline: RunTimeline): SubwayRunState {
  return { ...state, ...timeline, segment: timeline.segment ? { ...timeline.segment } : null, pendingCues: [...timeline.pendingCues] };
}

function shiftedTimeline(timeline: RunTimeline, delta: number): RunTimeline {
  return {
    ...timeline,
    phaseStartedAt: timeline.phaseStartedAt === null ? null : timeline.phaseStartedAt + delta,
    phaseDeadline: timeline.phaseDeadline === null ? null : timeline.phaseDeadline + delta,
    stopDeadline: timeline.stopDeadline === null ? null : timeline.stopDeadline + delta,
    segment: timeline.segment ? { ...timeline.segment, startedAt: timeline.segment.startedAt + delta } : null,
    pendingCues: timeline.pendingCues.map(cue => ({ ...cue, at: cue.at + delta })),
  };
}

function withDueCues(state: SubwayRunState, now: number, effects: RunEffect[]): SubwayRunState {
  if ((state.incident && state.phase !== 'emergency') || state.pausedAt !== null || !state.pendingCues.length) return state;
  const due = state.pendingCues.filter(cue => cue.at <= now);
  if (!due.length) return state;
  effects.push(...due.map(item => ({ type: 'play-cue' as const, id: item.id, cue: item.cue, generation: state.generation })));
  return { ...state, pendingCues: state.pendingCues.filter(cue => cue.at > now) };
}

function planFor(state: SubwayRunState, from: string, to: string, direction: string, plans: SubwayCuePlans): SegmentCuePlan {
  return plans[segmentPlanKey(state.lineId, from, to, direction)] ?? EMPTY_CUE_PLAN;
}

function prepareDwell(state: SubwayRunState, at: number, line: LineDefinition, plans: SubwayCuePlans): Pick<SubwayRunState, 'stopDeadline' | 'pendingCues'> {
  const target = stepStation(line, state.stationCode, state.direction);
  if (!state.active || !target || (line.loop && state.loopArrivalsRemaining <= 0)) return { stopDeadline: null, pendingCues: [] };
  const planKey = segmentPlanKey(line.id, state.stationCode, target.code, state.direction);
  const preClose = planFor(state, state.stationCode, target.code, state.direction, plans).preClose ?? [];
  const queued = scheduleCues(preClose, at, `${planKey}:pre-close`);
  return {
    stopDeadline: at + Math.max(state.dwellSeconds, cueQueueEnd(preClose)) * 1000,
    pendingCues: [...state.pendingCues.filter(cue => cue.at <= at), ...queued].sort((a, b) => a.at - b.at),
  };
}

function startClosing(state: SubwayRunState, at: number, line: LineDefinition, plans: SubwayCuePlans, effects: RunEffect[]): SubwayRunState {
  const target = stepStation(line, state.stationCode, state.direction);
  if (!target || (line.loop && state.loopArrivalsRemaining <= 0)) return { ...state, active: false, stopDeadline: null, phaseDeadline: null };
  const planKey = segmentPlanKey(line.id, state.stationCode, target.code, state.direction);
  const cuePlan = plans[planKey] ?? EMPTY_CUE_PLAN;
  validateDoorPlan(doorPlan(cuePlan, 'close'), 'close');
  validateDoorPlan(doorPlan(cuePlan, 'open'), 'open');
  const close = doorPlan(cuePlan, 'close');
  const closeMs = Math.max(close.close_end ?? 0, close.end) * 1000;
  const segment: RunSegment = {
    from: state.stationCode, to: target.code, direction: state.direction, planKey,
    multiplier: state.nextMultiplier, startedAt: at + closeMs + RELEASE_MS,
    departureMs: 0, cruiseMs: 0, approachMs: 0, baseProgress: 0, departed: false,
  };
  const departureSeconds = Math.max(MIN_SEGMENT_SECONDS.departure, cueQueueEnd(cuePlan.departure) + 2);
  const approachSeconds = Math.max(MIN_SEGMENT_SECONDS.approach, cueQueueEnd(cuePlan.arrival) + 2);
  const baseSeconds = 60 / segment.multiplier;
  const cruiseSeconds = Math.max(MIN_SEGMENT_SECONDS.cruise, baseSeconds - departureSeconds - approachSeconds);
  segment.departureMs = departureSeconds * 1000;
  segment.cruiseMs = cruiseSeconds * 1000;
  segment.approachMs = approachSeconds * 1000;
  const closeCues = scheduleDoorCues(close, at, `${planKey}:close`);
  pushPhase(effects, state, 'doorsClosing');
  return {
    ...state, phase: 'doorsClosing', doors: 'closing', active: true, stopDeadline: null,
    phaseStartedAt: at, phaseDeadline: at + Math.max(closeMs, close.end * 1000) + RELEASE_MS,
    segment, pendingCues: [...state.pendingCues, ...closeCues].sort((a, b) => a.at - b.at),
  };
}

function advanceOne(state: SubwayRunState, at: number, line: LineDefinition, plans: SubwayCuePlans, effects: RunEffect[]): SubwayRunState {
  const phase = state.phase;
  if (phase === 'stopped') {
    if (!state.active || state.stopDeadline === null) return state;
    return startClosing({ ...state, stopDeadline: null }, at, line, plans, effects);
  }
  if (phase === 'doorsClosing') {
    const segment = state.segment;
    if (!segment) return { ...state, active: false, phase: 'stopped', doors: 'open', phaseDeadline: null };
    const cuePlan = plans[segment.planKey] ?? EMPTY_CUE_PLAN;
    const nextSegment = { ...segment, startedAt: at, departed: true };
    pushPhase(effects, state, 'departing');
    effects.push({ type: 'departed', from: segment.from, to: segment.to, line: line.id, direction: segment.direction, generation: state.generation });
    return {
      ...state, phase: 'departing', doors: 'closed', phaseStartedAt: at, phaseDeadline: at + segment.departureMs,
      segment: nextSegment, pendingCues: [...state.pendingCues, ...scheduleCues(cuePlan.departure, at, `${segment.planKey}:departure`)].sort((a, b) => a.at - b.at),
    };
  }
  if (phase === 'departing') {
    const segment = state.segment;
    if (!segment) return state;
    pushPhase(effects, state, 'cruising');
    return { ...state, phase: 'cruising', doors: 'closed', phaseStartedAt: at, phaseDeadline: at + segment.cruiseMs };
  }
  if (phase === 'cruising') {
    const segment = state.segment;
    if (!segment) return state;
    const cuePlan = plans[segment.planKey] ?? EMPTY_CUE_PLAN;
    pushPhase(effects, state, 'approaching');
    return {
      ...state, phase: 'approaching', doors: 'closed', phaseStartedAt: at, phaseDeadline: at + segment.approachMs,
      pendingCues: [...state.pendingCues, ...scheduleCues(cuePlan.arrival, at, `${segment.planKey}:arrival`)].sort((a, b) => a.at - b.at),
    };
  }
  if (phase === 'approaching') {
    const segment = state.segment;
    if (!segment) return state;
    const cuePlan = plans[segment.planKey] ?? EMPTY_CUE_PLAN;
    const open = doorPlan(cuePlan, 'open');
    const openEnd = (open.open_end ?? open.end) * 1000;
    pushPhase(effects, state, 'arriving');
    effects.push({ type: 'arrived', from: segment.from, to: segment.to, line: line.id, direction: segment.direction, generation: state.generation });
    return {
      ...state, phase: 'arriving', doors: 'opening', stationCode: segment.to, phaseStartedAt: at,
      phaseDeadline: at + openEnd, pendingCues: [],
      loopArrivalsRemaining: line.loop ? Math.max(0, state.loopArrivalsRemaining - 1) : 0,
    };
  }
  if (phase === 'arriving') {
    const terminal = !stepStation(line, state.stationCode, state.direction) || (line.loop && state.loopArrivalsRemaining <= 0);
    pushPhase(effects, state, 'stopped');
    const stopped: SubwayRunState = {
      ...state, phase: 'stopped', doors: 'open', active: !terminal, phaseStartedAt: at,
      phaseDeadline: null, stopDeadline: null, segment: null, pendingCues: [],
    };
    return { ...stopped, ...prepareDwell(stopped, at, line, plans) };
  }
  return state;
}

function shiftStateTimes(state: SubwayRunState, delta: number): SubwayRunState {
  return installTimeline(state, shiftedTimeline(state, delta));
}

function applyIncident(state: SubwayRunState, kind: IncidentKind, now: number, plans: SubwayCuePlans, effects: RunEffect[]): SubwayRunState {
  if (state.incident) return state;
  const motion = snapshotMotion(state, now);
  const resume = copyTimeline(state);
  const doorsBefore = state.doors;
  const phase = kind === 'emergency' ? 'emergency' : 'suspended';
  pushPhase(effects, state, phase);
  if (kind === 'emergency') effects.push({ type: 'emergency', generation: state.generation });
  else effects.push({ type: 'suspended', generation: state.generation });
  const emergencyPlanKey = state.segment?.planKey ?? segmentPlanKey(state.lineId, state.stationCode, state.stationCode, state.direction);
  const emergencyCues = kind === 'emergency' ? scheduleCues(plans[emergencyPlanKey]?.emergency ?? [], now, `${emergencyPlanKey}:emergency`) : [];
  const incidentState: SubwayRunState = {
    ...state, phase, doors: motion.speed === 0 && doorsBefore === 'open' ? 'open' : 'closed',
    phaseStartedAt: now, phaseDeadline: null, stopDeadline: null, pendingCues: emergencyCues, pausedAt: null,
    incident: { kind, startedAt: now, brakeMs: motion.speed > 0 ? BRAKE_MS : 0, speedAtStart: motion.speed,
      progressAtStart: motion.progress, doorsBefore, resume },
  };
  return withDueCues(incidentState, now, effects);
}

function dueDeadline(state: SubwayRunState): number | null {
  if (state.phase === 'stopped' && state.active) return state.stopDeadline;
  if (state.phaseDeadline !== null && ['doorsClosing', 'departing', 'cruising', 'approaching', 'arriving'].includes(state.phase)) return state.phaseDeadline;
  if (state.incident && state.incident.brakeMs > 0 && state.phaseStartedAt !== null) return state.incident.startedAt + state.incident.brakeMs;
  return null;
}

function advance(state: SubwayRunState, now: number, lines: readonly LineDefinition[], plans: SubwayCuePlans, effects: RunEffect[]): SubwayRunState {
  let current = state;
  if (current.pausedAt !== null) return current;
  const pollingPhase = ['departing', 'cruising', 'approaching'].includes(current.phase) || !!current.incident?.brakeMs;
  if (pollingPhase && now - current.lastTickAt > MAX_GAP_MS) {
    const gap = now - current.lastTickAt;
    current = shiftStateTimes(current, gap);
    if (current.incident) current = { ...current, incident: { ...current.incident, startedAt: current.incident.startedAt + gap } };
    return { ...current, lastTickAt: now };
  }
  current = { ...current, lastTickAt: now };
  if (current.incident) {
    const incident = current.incident;
    current = withDueCues(current, now, effects);
    if (incident.brakeMs > 0 && now >= incident.startedAt + incident.brakeMs) {
      const heldMotion = snapshotMotion(current, now);
      const held = { ...incident, speedAtStart: 0, brakeMs: 0, progressAtStart: heldMotion.progress };
      return { ...current, incident: held, phaseStartedAt: now, lastTickAt: now };
    }
    return current;
  }
  current = withDueCues(current, now, effects);
  const line = lineFor(lines, current.lineId);
  for (let transitions = 0; transitions < 8; transitions++) {
    const deadline = dueDeadline(current);
    if (deadline === null || deadline > now) break;
    const at = deadline;
    current = withDueCues(current, at, effects);
    current = advanceOne(current, at, line, plans, effects);
    if (current.phase === 'arriving' && current.phaseDeadline === at) continue;
  }
  return current;
}

export function reduceRun(
  state: SubwayRunState,
  command: RunCommand,
  now: number,
  lines: readonly LineDefinition[],
  plans: SubwayCuePlans = {},
): RunTransition {
  finiteTime(now);
  const effects: RunEffect[] = [];
  let current = state;
  if (command.type === 'tick') return { state: advance(current, now, lines, plans, effects), effects };
  if (command.type === 'pause') {
    if (current.pausedAt !== null) return { state: current, effects };
    current = advance(current, now, lines, plans, effects);
    return { state: { ...current, pausedAt: now, lastTickAt: now }, effects };
  }
  if (command.type === 'resume') {
    if (current.pausedAt === null) return { state: current, effects };
    const delta = Math.max(0, now - current.pausedAt);
    const resumed = shiftStateTimes({ ...current, pausedAt: null }, delta);
    return { state: { ...resumed, lastTickAt: now }, effects };
  }
  if (command.type === 'emergency' || command.type === 'suspend') {
    current = advance(current, now, lines, plans, effects);
    return { state: applyIncident(current, command.type === 'emergency' ? 'emergency' : 'suspended', now, plans, effects), effects };
  }
  if (command.type === 'resume-service') {
    if (!current.incident || current.incident.brakeMs > 0) return { state: current, effects };
    const incident = current.incident;
    const duration = Math.max(0, now - incident.startedAt);
    const timeline = shiftedTimeline(incident.resume, duration);
    current = { ...current, ...timeline, incident: null, lastTickAt: now };
    const resumedSegment = incident.resume.segment;
    let resumedAtDestination = false;
    if (resumedSegment && resumedSegment.departed && ['departing', 'cruising', 'approaching'].includes(incident.resume.phase)) {
      if (incident.progressAtStart >= 1) {
        const totalMs = resumedSegment.departureMs + resumedSegment.cruiseMs + resumedSegment.approachMs;
        current = { ...current, phase: 'approaching', doors: 'closed', phaseStartedAt: now, phaseDeadline: now,
          segment: { ...resumedSegment, startedAt: now - totalMs, baseProgress: 1 } };
        current = withDueCues(current, now, effects);
        current = advanceOne(current, now, lineFor(lines, current.lineId), plans, effects);
        resumedAtDestination = true;
      } else {
        current = { ...current, phase: 'departing', doors: 'closed', phaseStartedAt: now,
          phaseDeadline: now + resumedSegment.departureMs,
          segment: { ...resumedSegment, startedAt: now, baseProgress: incident.progressAtStart, departed: true } };
      }
    }
    if (!resumedAtDestination) pushPhase(effects, { ...current, phase: state.phase }, current.phase);
    return { state: { ...current, lastTickAt: now }, effects };
  }
  if (command.type === 'set-immersion') return { state: { ...current, immersion: command.enabled }, effects };
  if (command.type === 'set-speed') {
    if (![0.5, 1, 2].includes(command.multiplier)) throw new Error('Run speed must be 0.5, 1, or 2');
    return { state: { ...current, nextMultiplier: command.multiplier }, effects };
  }
  if (command.type === 'set-line') {
    const line = lineFor(lines, command.lineId);
    const stationCode = command.stationCode ?? line.stations[0]?.code;
    if (!stationCode || !line.stations.some(station => station.code === stationCode)) throw new Error(`Unknown station for ${line.id}: ${stationCode}`);
    current = { ...current, lineId: line.id, stationCode, direction: line.directions[0].id, phase: 'stopped', doors: 'open', active: false,
      phaseStartedAt: null, phaseDeadline: null, stopDeadline: null, segment: null, pendingCues: [],
      loopArrivalsRemaining: line.loop ? line.stations.length : 0, incident: null, pausedAt: null, generation: current.generation + 1 };
    return { state: current, effects };
  }
  if (command.type === 'set-direction' || command.type === 'reverse') {
    const line = lineFor(lines, current.lineId);
    const direction = command.type === 'reverse'
      ? line.directions.find(item => item.id !== current.direction)?.id
      : command.direction;
    if (!direction || !line.directions.some(item => item.id === direction)) throw new Error(`Unknown direction for ${line.id}: ${direction}`);
    const canRun = !!stepStation(line, current.stationCode, direction);
    const startsFromTerminal = !current.active && current.phase === 'stopped' && canRun;
    let next = { ...current, direction, ...(startsFromTerminal ? { active: true } : {}) };
    if (next.phase === 'stopped' && next.active) next = { ...next, ...prepareDwell({ ...next, pendingCues: [] }, now, line, plans) };
    return { state: next, effects };
  }
  if (command.type === 'start') {
    const line = lineFor(lines, current.lineId);
    if (current.phase !== 'stopped' || current.incident || current.active || !stepStation(line, current.stationCode, current.direction)) return { state: current, effects };
    const started = { ...current, active: true, generation: current.generation + 1, lastTickAt: now };
    return { state: { ...started, ...prepareDwell(started, now, lineFor(lines, started.lineId), plans) }, effects };
  }
  return { state: current, effects };
}

function travelDurationMs(plan: SegmentCuePlan, multiplier: number): number {
  const departure = Math.max(MIN_SEGMENT_SECONDS.departure, cueQueueEnd(plan.departure) + 2);
  const approach = Math.max(MIN_SEGMENT_SECONDS.approach, cueQueueEnd(plan.arrival) + 2);
  const cruise = Math.max(MIN_SEGMENT_SECONDS.cruise, 60 / multiplier - departure - approach);
  return (departure + cruise + approach) * 1000;
}

function routeSegments(
  line: LineDefinition,
  stationCode: string,
  direction: string,
  limit = Number.POSITIVE_INFINITY,
): Array<{ from: string; to: string }> {
  const result: Array<{ from: string; to: string }> = [];
  let current = stationCode;
  while (result.length < limit) {
    const next = stepStation(line, current, direction);
    if (!next) break;
    result.push({ from: current, to: next.code });
    current = next.code;
    if (line.loop && current === stationCode) break;
  }
  return result;
}

function stopBudgetMs(
  state: SubwayRunState,
  line: LineDefinition,
  from: string,
  to: string,
  direction: string,
  multiplier: number,
  plans: SubwayCuePlans,
  includeDwell: boolean,
): number {
  const plan = plans[segmentPlanKey(line.id, from, to, direction)] ?? EMPTY_CUE_PLAN;
  const close = doorPlan(plan, 'close');
  const open = doorPlan(plan, 'open');
  const dwell = includeDwell ? Math.max(state.dwellSeconds, cueQueueEnd(plan.preClose ?? [])) * 1000 : 0;
  const closeAndRelease = Math.max(close.close_end ?? 0, close.end) * 1000 + RELEASE_MS;
  const opening = (open.open_end ?? open.end) * 1000;
  return dwell + closeAndRelease + travelDurationMs(plan, multiplier) + opening;
}

function remainingJourneyMs(state: SubwayRunState, now: number, line: LineDefinition, plans: SubwayCuePlans): number {
  const at = activeNow(state, now);
  const timeline = state.incident?.resume ?? state;
  const timelineAt = state.incident ? state.incident.startedAt : at;
  let remaining = state.incident ? Math.max(0, state.incident.brakeMs - (at - state.incident.startedAt)) : 0;

  if (timeline.segment) {
    const segment = timeline.segment;
    const plan = plans[segment.planKey] ?? EMPTY_CUE_PLAN;
    const trainTime = travelDurationMs(plan, segment.multiplier);
    if (timeline.phase === 'arriving') {
      remaining += Math.max(0, (timeline.phaseDeadline ?? timelineAt) - timelineAt);
    } else if (timeline.phase === 'doorsClosing') {
      remaining += Math.max(0, (timeline.phaseDeadline ?? timelineAt) - timelineAt) + trainTime;
      const open = doorPlan(plan, 'open');
      remaining += (open.open_end ?? open.end) * 1000;
    } else {
      remaining += Math.max(0, trainTime - Math.max(0, timelineAt - segment.startedAt));
      const open = doorPlan(plan, 'open');
      remaining += (open.open_end ?? open.end) * 1000;
    }

    const remainingLoopStops = line.loop
      ? Math.max(0, state.loopArrivalsRemaining - (timeline.phase === 'arriving' ? 0 : 1))
      : Number.POSITIVE_INFINITY;
    for (const future of routeSegments(line, segment.to, segment.direction, remainingLoopStops)) {
      remaining += stopBudgetMs(state, line, future.from, future.to, segment.direction, state.nextMultiplier, plans, true);
    }
    return remaining;
  }

  if (timeline.phase !== 'stopped' || !timeline.active) return remaining;
  const limit = line.loop ? state.loopArrivalsRemaining : Number.POSITIVE_INFINITY;
  const future = routeSegments(line, timeline.stationCode, state.direction, limit);
  for (let index = 0; index < future.length; index++) {
    const segment = future[index];
    remaining += stopBudgetMs(state, line, segment.from, segment.to, state.direction, state.nextMultiplier, plans, index > 0);
  }
  return remaining;
}

export function snapshotRun(state: SubwayRunState, now: number, lines: readonly LineDefinition[], plans: SubwayCuePlans = {}): RunSnapshot {
  finiteTime(now);
  const line = lineFor(lines, state.lineId);
  const at = activeNow(state, now);
  const motion = snapshotMotion(state, at);
  const station = line.stations.find(item => item.code === state.stationCode)!;
  const side = station.doorByDirection[state.direction]?.side ?? 'unknown';
  const hasCommittedArrival = state.phase === 'arriving' || state.incident?.resume.phase === 'arriving';
  const next = hasCommittedArrival
    ? (state.active ? stepStation(line, state.stationCode, state.direction)?.code : '') ?? ''
    : state.segment?.to ?? (state.phase === 'stopped' && state.active ? stepStation(line, state.stationCode, state.direction)?.code : '') ?? '';
  const braking = !!state.incident;
  const power = braking ? 0 : state.phase === 'departing' ? 1 : state.phase === 'cruising' ? 0.35 : 0;
  const brake = braking || state.phase === 'stopped' || state.phase === 'arriving' ||
    (state.phase === 'doorsClosing' && state.segment !== null && at < state.segment.startedAt)
    ? 1 : state.phase === 'approaching' ? 0.35 : 0;
  const remaining = remainingJourneyMs(state, at, line, plans);
  return {
    station: state.stationCode, next, state: state.phase, line: line.id, direction: state.segment?.direction ?? state.direction,
    doorSide: side, doors: state.doors, speed: clamp(motion.speed, 0, 60), power, brake,
    progress: clamp(motion.progress, 0, 1), paused: state.pausedAt !== null, immersion: state.immersion,
    generation: state.generation, multiplier: state.nextMultiplier, remainingMinutes: Math.ceil(Math.max(0, remaining) / 60_000),
  };
}

export function nextRunWake(state: SubwayRunState, now: number): number | null {
  if (state.pausedAt !== null) return null;
  if (state.incident) {
    if (state.incident.kind === 'suspended') return null;
    const cueDeadline = state.pendingCues[0]?.at ?? Number.POSITIVE_INFINITY;
    const brakeDeadline = state.incident.brakeMs > 0 ? Math.min(now + 50, state.incident.startedAt + state.incident.brakeMs) : Number.POSITIVE_INFINITY;
    const wakeAt = Math.min(cueDeadline, brakeDeadline);
    return Number.isFinite(wakeAt) ? wakeAt : null;
  }
  if (['departing', 'cruising', 'approaching'].includes(state.phase)) return Math.min(now + 50, state.phaseDeadline ?? now + 50);
  return dueDeadline(state);
}

import { LINE_CATALOGUE } from '../data/load';
export type CueRole = 'voice' | 'melody' | 'chime' | 'signal' | 'mechanics' | 'bell';
export type CueStatus = 'approved' | 'needs ear check' | 'mixed' | string;

export interface RuntimeCue {
  file: string;
  offset: number;
  duration: number;
  audible_end: number;
  gainByRole: Partial<Record<CueRole, number>>;
  sha256: string;
  status: CueStatus;
  source: unknown;
}

export interface RuntimeCueManifest {
  version: 1;
  inputs: Readonly<Record<string, string>>;
  cues: readonly RuntimeCue[];
}

export interface PackCueRecord {
  file: string;
  status?: CueStatus;
  kind?: string;
  station?: string;
  direction?: string;
  directions?: readonly string[];
  lang?: string;
  side?: string;
  text?: string;
  [key: string]: unknown;
}

export interface ResolvedCue extends RuntimeCue {
  gain: number;
  role?: CueRole;
  url: string;
}

export interface TimedCue {
  part: string;
  at: number;
  cue: ResolvedCue;
}

export interface DoorSequencePlan {
  events: Array<{ part: string; at: number; cue: ResolvedCue }>;
  end: number;
  open_end?: number;
  close_end?: number;
  departure_melody_end?: number;
}

export interface DoorSequenceApi {
  plan(
    line: { sequence: unknown; cues: Record<string, ResolvedCue> },
    action: 'open' | 'close',
  ): DoorSequencePlan;
}

export interface SegmentCuePlan {
  close: DoorSequencePlan;
  open: DoorSequencePlan;
  preClose?: readonly TimedCue[];
  departure: readonly TimedCue[];
  arrival: readonly TimedCue[];
  emergency?: readonly TimedCue[];
}

export interface LoadedSubwayLine {
  line: Record<string, unknown>;
  pack: Record<string, unknown>;
}

export interface LoadedSubwayAssets {
  catalogue: RuntimeCueManifest;
  lines: Readonly<Record<string, LoadedSubwayLine>>;
  doorSequence: DoorSequenceApi;
}

type SubwayGlobals = typeof globalThis & {
  DoorSequence?: DoorSequenceApi;
  MOTION_PACK?: { profiles: readonly unknown[] };
  TrainMotion?: TrainMotionApi;
};

export interface TrainMotionApi {
  MotionAudio: {
    new (
      context: AudioContext,
      profile: unknown,
      decoded: Map<string, AudioBuffer>,
    ): MotionAudioInstance;
    load(context: AudioContext, profile: unknown): Promise<MotionAudioInstance>;
  };
  playCue(
    context: AudioContext,
    destination: AudioNode,
    buffer: AudioBuffer,
    cue: ResolvedCue,
    when: number,
  ): AudioBufferSourceNode;
}

export interface MotionAudioInstance {
  update(state: { speed: number; power: number; brake: number }): void;
  volume(value: number): void;
  reset(): void;
  dispose(): void;
}

const bundlePromises = new Map<string, Promise<LoadedSubwayAssets>>();
const scriptPromises = new Map<string, Promise<void>>();
const lineIds = LINE_CATALOGUE.map((line) => line.id);
const warnedVariantFallbacks = new Set<string>();
const doorRoles: Readonly<Record<string, CueRole>> = {
  chime_open: 'chime',
  chime_close: 'chime',
  signal: 'signal',
  open: 'mechanics',
  close: 'mechanics',
  platform_open: 'signal',
  platform_close: 'signal',
  bell: 'bell',
  departure_melody: 'melody',
};

function globals(): SubwayGlobals {
  return globalThis as SubwayGlobals;
}

function normalizedBase(base?: string): URL {
  const locationUrl = typeof location === 'undefined' ? undefined : location.href;
  if (!base && !locationUrl) throw new Error('Subway assets require a browser location');
  const root = new URL(base ?? '/subway/', locationUrl ?? 'http://localhost/');
  if (locationUrl && root.origin !== new URL(locationUrl).origin)
    throw new Error('Subway assets must stay same-origin');
  if (!root.pathname.endsWith('/')) root.pathname += '/';
  return root;
}

export function resolveAssetUrl(file: string, base: string): string {
  if (
    !file ||
    file.startsWith('/') ||
    file.includes('\\') ||
    file.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe Subway asset path: ${file}`);
  }
  const root = normalizedBase(base);
  const url = new URL(file.split('/').map(encodeURIComponent).join('/'), root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname))
    throw new Error(`Subway asset leaves its base path: ${file}`);
  return url.href;
}

function cueIndex(manifest: RuntimeCueManifest): Map<string, RuntimeCue> {
  if (manifest.version !== 1 || !Array.isArray(manifest.cues))
    throw new Error('Unsupported Subway cue catalogue');
  const result = new Map<string, RuntimeCue>();
  for (const cue of manifest.cues) {
    if (
      !cue.file ||
      result.has(cue.file) ||
      !Number.isFinite(cue.offset) ||
      cue.offset < 0 ||
      !Number.isFinite(cue.duration) ||
      cue.duration <= 0 ||
      !Number.isFinite(cue.audible_end) ||
      cue.audible_end < 0 ||
      cue.audible_end > cue.duration ||
      !/^[a-f0-9]{64}$/i.test(cue.sha256)
    ) {
      throw new Error(`Invalid or duplicate Subway cue: ${cue.file}`);
    }
    if (!cue.gainByRole || typeof cue.gainByRole !== 'object')
      throw new Error(`Missing Subway cue gains: ${cue.file}`);
    for (const gain of Object.values(cue.gainByRole)) {
      if (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0 || gain > 4)
        throw new Error(`Invalid Subway cue gain: ${cue.file}`);
    }
    result.set(cue.file, cue);
  }
  return result;
}

export function resolveCue(
  record: PackCueRecord,
  role: CueRole,
  manifest: RuntimeCueManifest,
  base: string,
  stationCode?: string,
): ResolvedCue {
  const variants = Array.isArray(record.variants)
    ? (record.variants as { stations?: unknown; file?: unknown }[])
    : [];
  const variant = stationCode
    ? variants.find(
        (item) =>
          Array.isArray(item.stations) &&
          item.stations.includes(stationCode) &&
          typeof item.file === 'string',
      )
    : undefined;
  let file = (variant?.file as string | undefined) ?? record.file;
  let entry = cueIndex(manifest).get(file);
  let gain = entry?.gainByRole[role];
  if (variant && (!entry || gain === undefined)) {
    if (!warnedVariantFallbacks.has(file)) {
      warnedVariantFallbacks.add(file);
      console.warn(`Subway station cue unavailable; using line default: ${file} → ${record.file}`);
    }
    file = record.file;
    entry = cueIndex(manifest).get(file);
    gain = entry?.gainByRole[role];
  }
  if (!entry || gain === undefined) throw new Error(`Missing ${role} catalogue entry: ${file}`);
  return { ...entry, gain, role, url: resolveAssetUrl(file, base) };
}

export function selectDirectionalEntries(
  entries: readonly PackCueRecord[] | undefined,
  direction: string,
): PackCueRecord[] {
  if (!entries?.length) return [];
  const exact = entries.filter((entry) => entry.direction === direction);
  const compatible = entries.filter(
    (entry) => !entry.direction && entry.directions?.includes(direction),
  );
  const neutral = entries.filter((entry) => !entry.direction && !entry.directions?.length);
  const selected = exact.length ? exact : compatible.length ? compatible : neutral;
  const seen = new Set<string>();
  return selected.filter((entry) => {
    if (seen.has(entry.file)) return false;
    seen.add(entry.file);
    return true;
  });
}

export function selectStationEntries(
  entries: readonly PackCueRecord[] | undefined,
  stationCode: string,
  kind: string,
  direction: string,
): PackCueRecord[] {
  return selectDirectionalEntries(
    entries?.filter((entry) => entry.station === stationCode && entry.kind === kind),
    direction,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function packStations(line: LoadedSubwayLine): Record<string, unknown>[] {
  const stations = line.pack.stations;
  const values = Array.isArray(stations)
    ? stations
    : stations && typeof stations === 'object'
      ? Object.values(stations as Record<string, unknown>)
      : [];
  return values.map(asRecord).filter((item): item is Record<string, unknown> => !!item);
}

function packStation(line: LoadedSubwayLine, code: string): Record<string, unknown> | undefined {
  return packStations(line).find((station) => station.code === code);
}

function cueEntries(value: unknown, language: string): PackCueRecord[] {
  const localized = asRecord(value)?.[language];
  return Array.isArray(localized)
    ? localized.filter(
        (entry): entry is PackCueRecord =>
          !!asRecord(entry) && typeof (entry as PackCueRecord).file === 'string',
      )
    : [];
}

function queueStationCues(
  station: Record<string, unknown>,
  group: 'next' | 'arriving' | 'transfer',
  stationCode: string,
  direction: string,
  languages: readonly string[],
  catalogue: RuntimeCueManifest,
  base: string,
): TimedCue[] {
  const result: TimedCue[] = [];
  let at = 0;
  for (const language of languages) {
    const selected = selectStationEntries(
      cueEntries(station[group], language),
      stationCode,
      group === 'next' ? 'next' : group,
      direction,
    )[0];
    if (!selected) continue;
    const cue = resolveCue(selected, 'voice', catalogue, base);
    result.push({ part: `${group}:${language}`, at, cue });
    at += cue.duration + 0.3;
  }
  return result;
}

function packDepartureMelody(line: LoadedSubwayLine): PackCueRecord | undefined {
  const entries = Array.isArray(line.pack.on_station) ? line.pack.on_station : [];
  return entries
    .map(asRecord)
    .find(
      (entry): entry is Record<string, unknown> & PackCueRecord =>
        !!entry &&
        (entry.kind === 'departure_melody' ||
          (typeof entry.text === 'string' &&
            entry.text.trim().toLowerCase() === 'departure melody')),
    );
}

function departureMelody(
  line: LoadedSubwayLine,
  station: Record<string, unknown>,
  stationCode: string,
  direction: string,
  catalogue: RuntimeCueManifest,
  base: string,
): ResolvedCue | undefined {
  const byDirection = asRecord(station.departure_melody);
  const stationMelody = asRecord(byDirection?.[direction]) as PackCueRecord | undefined;
  const melody =
    stationMelody && typeof stationMelody.file === 'string'
      ? stationMelody
      : packDepartureMelody(line);
  return melody && typeof melody.file === 'string'
    ? resolveCue(melody, 'melody', catalogue, base, stationCode)
    : undefined;
}

function planContainsDepartureMelody(sequence: unknown): boolean {
  const close = asRecord(sequence)?.close;
  return Array.isArray(close) && close.some((step) => asRecord(step)?.part === 'departure_melody');
}

function withoutDepartureMelodyAnchor(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const match = /^departure_melody_end([+-]\d+(?:\.\d+)?)?$/.exec(value);
  return match ? Number(match[1] ?? 0) : value;
}

function resolveDoorPlanLine(
  line: LoadedSubwayLine,
  catalogue: RuntimeCueManifest,
  base: string,
  stationCode?: string,
  melody?: ResolvedCue,
): { sequence: unknown; cues: Record<string, ResolvedCue> } {
  const doors = line.pack.doors as { sequence?: unknown; [key: string]: unknown } | undefined;
  if (!doors?.sequence) throw new Error(`Door sequence missing for ${String(line.pack.id)}`);
  const sequenceRecord = asRecord(doors.sequence);
  const closeSteps = sequenceRecord?.close;
  const filteredSequence =
    Array.isArray(closeSteps) && !melody
      ? {
          ...sequenceRecord,
          close: closeSteps
            .filter((step) => asRecord(step)?.part !== 'departure_melody')
            .map((step) => {
              const record = asRecord(step);
              if (!record) return step;
              return {
                ...record,
                ...(Object.hasOwn(record, 'at')
                  ? { at: withoutDepartureMelodyAnchor(record.at) }
                  : {}),
                ...(Object.hasOwn(record, 'until')
                  ? { until: withoutDepartureMelodyAnchor(record.until) }
                  : {}),
              };
            }),
        }
      : doors.sequence;
  const cues: Record<string, ResolvedCue> = {};
  if (melody) cues.departure_melody = melody;
  for (const [part, value] of Object.entries(doors)) {
    if (
      part === 'sequence' ||
      !asRecord(value) ||
      typeof (value as PackCueRecord).file !== 'string'
    )
      continue;
    const role = doorRoles[part];
    if (!role) throw new Error(`Unknown Subway door cue role: ${part}`);
    cues[part] = resolveCue(value as PackCueRecord, role, catalogue, base, stationCode);
  }
  return { sequence: filteredSequence, cues };
}

function freezePlan(plan: DoorSequencePlan): DoorSequencePlan {
  const events = plan.events.map((event) =>
    Object.freeze({
      ...event,
      cue: Object.freeze({
        ...event.cue,
        audible_end: Math.min(event.cue.audible_end, event.cue.duration),
      }),
    }),
  );
  return Object.freeze({
    ...plan,
    events: Object.freeze(events) as unknown as DoorSequencePlan['events'],
  });
}

export function buildSegmentCuePlan(
  line: LoadedSubwayLine,
  from: string,
  to: string,
  direction: string,
  languages: readonly string[],
  hasTransfers: boolean,
  catalogue: RuntimeCueManifest,
  base: string,
  planner: DoorSequenceApi,
): SegmentCuePlan {
  const source = packStation(line, from);
  const target = packStation(line, to);
  if (!source || !target) throw new Error(`Missing Subway pack station for ${from} → ${to}`);
  const languageOrder = [...new Set(languages)].filter((language) =>
    ['ja', 'en', 'zh', 'ko'].includes(language),
  );
  const melody = departureMelody(line, source, from, direction, catalogue, base);
  const doors = asRecord(line.pack.doors);
  const sequence = doors?.sequence;
  const includesMelody = planContainsDepartureMelody(sequence);
  const closeInput = resolveDoorPlanLine(
    line,
    catalogue,
    base,
    from,
    includesMelody ? melody : undefined,
  );
  const openInput = resolveDoorPlanLine(line, catalogue, base, to);
  const close = freezePlan(planner.plan(closeInput, 'close'));
  const open = freezePlan(planner.plan(openInput, 'open'));
  const departure = queueStationCues(target, 'next', to, direction, languageOrder, catalogue, base);
  const arrival = [
    ...queueStationCues(target, 'arriving', to, direction, languageOrder, catalogue, base),
    ...(hasTransfers
      ? queueStationCues(target, 'transfer', to, direction, languageOrder, catalogue, base)
      : []),
  ];
  const emergency: TimedCue[] = [];
  const emergencyRecords = (Array.isArray(line.pack.emergency) ? line.pack.emergency : []).filter(
    (entry): entry is PackCueRecord =>
      !!asRecord(entry) &&
      (entry as PackCueRecord).kind === 'emergency' &&
      (entry as PackCueRecord).scenario === 'emergency stop',
  );
  let at = 0;
  for (const language of languageOrder) {
    const selected = selectDirectionalEntries(
      emergencyRecords.filter((entry) => entry.lang === language),
      direction,
    )[0];
    if (!selected) continue;
    const cue = resolveCue(selected, 'voice', catalogue, base);
    emergency.push({ part: `emergency:${language}`, at, cue });
    at += cue.duration + 0.3;
  }
  const preClose =
    melody && !includesMelody ? [{ part: 'departure_melody', at: 0, cue: melody }] : [];
  return Object.freeze({
    close,
    open,
    ...(preClose.length
      ? { preClose: Object.freeze(preClose.map((item) => Object.freeze(item))) }
      : {}),
    departure: Object.freeze(departure.map((item) => Object.freeze(item))),
    arrival: Object.freeze(arrival.map((item) => Object.freeze(item))),
    emergency: Object.freeze(emergency.map((item) => Object.freeze(item))),
  });
}

function fetchJson<T>(url: string): Promise<T> {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Subway asset request failed (${response.status}): ${url}`);
    return response.json() as Promise<T>;
  });
}

function loadScript(url: string, available: () => boolean): Promise<void> {
  if (available()) return Promise.resolve();
  const existing = scriptPromises.get(url);
  if (existing) return existing;
  if (typeof document === 'undefined')
    return Promise.reject(new Error('Subway scripts require a browser document'));
  const inDom = [...document.scripts].find((script) => script.src === url);
  if (inDom?.dataset.subwayLoaded === 'true')
    return Promise.reject(new Error(`Subway script did not expose its API: ${url}`));
  const promise = new Promise<void>((resolve, reject) => {
    const script = inDom ?? document.createElement('script');
    script.addEventListener(
      'load',
      () => {
        script.dataset.subwayLoaded = 'true';
        available() ? resolve() : reject(new Error(`Subway script did not expose its API: ${url}`));
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => reject(new Error(`Unable to load Subway script: ${url}`)),
      { once: true },
    );
    if (!inDom) {
      script.src = url;
      script.async = true;
      document.head.append(script);
    }
  }).catch((error) => {
    scriptPromises.delete(url);
    throw error;
  });
  scriptPromises.set(url, promise);
  return promise;
}

export async function loadSubwayAssets(base?: string): Promise<LoadedSubwayAssets> {
  const root = normalizedBase(base);
  const key = root.href;
  let pending = bundlePromises.get(key);
  if (!pending) {
    pending = (async () => {
      await loadScript(
        resolveAssetUrl('motion/door-sequence.js', key),
        () => !!globals().DoorSequence,
      );
      const [catalogue, ...lineFiles] = await Promise.all([
        fetchJson<RuntimeCueManifest>(resolveAssetUrl('motion/runtime-cues.json', key)),
        ...lineIds.flatMap((id) => [
          fetchJson<Record<string, unknown>>(resolveAssetUrl(`lines/${id}/line.json`, key)),
          fetchJson<Record<string, unknown>>(resolveAssetUrl(`lines/${id}/pack.json`, key)),
        ]),
      ]);
      cueIndex(catalogue);
      const lines: Record<string, LoadedSubwayLine> = {};
      lineIds.forEach((id, index) => {
        lines[id] = { line: lineFiles[index * 2], pack: lineFiles[index * 2 + 1] };
      });
      const doorSequence = globals().DoorSequence;
      if (!doorSequence) throw new Error('Subway door planner is unavailable');
      return { catalogue, lines: Object.freeze(lines), doorSequence };
    })().catch((error) => {
      bundlePromises.delete(key);
      throw error;
    });
    bundlePromises.set(key, pending);
  }
  return pending;
}

export async function loadSubwayMotionEngine(
  base?: string,
): Promise<{ api: TrainMotionApi; profiles: readonly unknown[] }> {
  const root = normalizedBase(base);
  const dataUrl = resolveAssetUrl('motion/data.js', root.href);
  const engineUrl = resolveAssetUrl('motion/engine.js', root.href);
  await loadScript(dataUrl, () => !!globals().MOTION_PACK);
  await loadScript(engineUrl, () => !!globals().TrainMotion);
  const motionPack = globals().MOTION_PACK;
  const api = globals().TrainMotion;
  if (!motionPack?.profiles || !api) throw new Error('Subway motion engine is unavailable');
  return { api, profiles: motionPack.profiles };
}

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
  url: string;
}

export interface DoorSequencePlan {
  events: Array<{ part: string; at: number; cue: ResolvedCue }>;
  end: number;
  open_end?: number;
  close_end?: number;
  departure_melody_end?: number;
}

export interface DoorSequenceApi {
  plan(line: { sequence: unknown; cues: Record<string, ResolvedCue> }, action: 'open' | 'close'): DoorSequencePlan;
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
  MotionAudio: new (context: AudioContext, profile: unknown, decoded: Map<string, AudioBuffer>) => MotionAudioInstance;
  playCue(context: AudioContext, destination: AudioNode, buffer: AudioBuffer, cue: ResolvedCue, when: number): AudioBufferSourceNode;
}

export interface MotionAudioInstance {
  update(state: { speed: number; power: number; brake: number }): void;
  volume(value: number): void;
  reset(): void;
  dispose(): void;
}

const bundlePromises = new Map<string, Promise<LoadedSubwayAssets>>();
const scriptPromises = new Map<string, Promise<void>>();
const lineIds = ['yamanote', 'hibiya', 'sakaisuji'] as const;
const doorRoles: Readonly<Record<string, CueRole>> = {
  chime_open: 'chime', chime_close: 'chime', signal: 'signal', open: 'mechanics', close: 'mechanics',
  platform_open: 'signal', platform_close: 'signal', bell: 'bell',
};

function globals(): SubwayGlobals { return globalThis as SubwayGlobals; }

function normalizedBase(base?: string): URL {
  const locationUrl = typeof location === 'undefined' ? undefined : location.href;
  if (!base && !locationUrl) throw new Error('Subway assets require a browser location');
  const root = new URL(base ?? '/subway/', locationUrl ?? 'http://localhost/');
  if (locationUrl && root.origin !== new URL(locationUrl).origin) throw new Error('Subway assets must stay same-origin');
  if (!root.pathname.endsWith('/')) root.pathname += '/';
  return root;
}

export function resolveAssetUrl(file: string, base: string): string {
  if (!file || file.startsWith('/') || file.includes('\\') || file.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe Subway asset path: ${file}`);
  }
  const root = normalizedBase(base);
  const url = new URL(file.split('/').map(encodeURIComponent).join('/'), root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) throw new Error(`Subway asset leaves its base path: ${file}`);
  return url.href;
}

function cueIndex(manifest: RuntimeCueManifest): Map<string, RuntimeCue> {
  if (manifest.version !== 1 || !Array.isArray(manifest.cues)) throw new Error('Unsupported Subway cue catalogue');
  const result = new Map<string, RuntimeCue>();
  for (const cue of manifest.cues) {
    if (!cue.file || result.has(cue.file) || !Number.isFinite(cue.offset) || cue.offset < 0 ||
        !Number.isFinite(cue.duration) || cue.duration <= 0 || !Number.isFinite(cue.audible_end) ||
        cue.audible_end < 0 || cue.audible_end > cue.duration || !/^[a-f0-9]{64}$/i.test(cue.sha256)) {
      throw new Error(`Invalid or duplicate Subway cue: ${cue.file}`);
    }
    if (!cue.gainByRole || typeof cue.gainByRole !== 'object') throw new Error(`Missing Subway cue gains: ${cue.file}`);
    for (const gain of Object.values(cue.gainByRole)) {
      if (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0 || gain > 4)
        throw new Error(`Invalid Subway cue gain: ${cue.file}`);
    }
    result.set(cue.file, cue);
  }
  return result;
}

export function resolveCue(record: Pick<PackCueRecord, 'file'>, role: CueRole, manifest: RuntimeCueManifest, base: string): ResolvedCue {
  const entry = cueIndex(manifest).get(record.file);
  const gain = entry?.gainByRole[role];
  if (!entry || gain === undefined) throw new Error(`Missing ${role} catalogue entry: ${record.file}`);
  return { ...entry, gain, url: resolveAssetUrl(record.file, base) };
}

export function selectDirectionalEntries(entries: readonly PackCueRecord[] | undefined, direction: string): PackCueRecord[] {
  if (!entries?.length) return [];
  const exact = entries.filter(entry => entry.direction === direction);
  const compatible = entries.filter(entry => !entry.direction && entry.directions?.includes(direction));
  const neutral = entries.filter(entry => !entry.direction && !entry.directions?.length);
  const selected = exact.length ? exact : compatible.length ? compatible : neutral;
  const seen = new Set<string>();
  return selected.filter(entry => {
    if (seen.has(entry.file)) return false;
    seen.add(entry.file);
    return true;
  });
}

function fetchJson<T>(url: string): Promise<T> {
  return fetch(url).then(response => {
    if (!response.ok) throw new Error(`Subway asset request failed (${response.status}): ${url}`);
    return response.json() as Promise<T>;
  });
}

function loadScript(url: string, available: () => boolean): Promise<void> {
  if (available()) return Promise.resolve();
  const existing = scriptPromises.get(url);
  if (existing) return existing;
  if (typeof document === 'undefined') return Promise.reject(new Error('Subway scripts require a browser document'));
  const inDom = [...document.scripts].find(script => script.src === url);
  if (inDom?.dataset.subwayLoaded === 'true') return Promise.reject(new Error(`Subway script did not expose its API: ${url}`));
  const promise = new Promise<void>((resolve, reject) => {
    const script = inDom ?? document.createElement('script');
    script.addEventListener('load', () => {
      script.dataset.subwayLoaded = 'true';
      available() ? resolve() : reject(new Error(`Subway script did not expose its API: ${url}`));
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Unable to load Subway script: ${url}`)), { once: true });
    if (!inDom) {
      script.src = url;
      script.async = true;
      document.head.append(script);
    }
  }).catch(error => {
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
      await loadScript(resolveAssetUrl('motion/door-sequence.js', key), () => !!globals().DoorSequence);
      const [catalogue, ...lineFiles] = await Promise.all([
        fetchJson<RuntimeCueManifest>(resolveAssetUrl('motion/runtime-cues.json', key)),
        ...lineIds.flatMap(id => [
          fetchJson<Record<string, unknown>>(resolveAssetUrl(`lines/${id}/line.json`, key)),
          fetchJson<Record<string, unknown>>(resolveAssetUrl(`lines/${id}/pack.json`, key)),
        ]),
      ]);
      cueIndex(catalogue);
      const lines: Record<string, LoadedSubwayLine> = {};
      lineIds.forEach((id, index) => { lines[id] = { line: lineFiles[index * 2], pack: lineFiles[index * 2 + 1] }; });
      const doorSequence = globals().DoorSequence;
      if (!doorSequence) throw new Error('Subway door planner is unavailable');
      return { catalogue, lines: Object.freeze(lines), doorSequence };
    })().catch(error => {
      bundlePromises.delete(key);
      throw error;
    });
    bundlePromises.set(key, pending);
  }
  return pending;
}

export async function loadSubwayMotionEngine(base?: string): Promise<{ api: TrainMotionApi; profiles: readonly unknown[] }> {
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

export function resolveDoorPlanLine(line: LoadedSubwayLine, catalogue: RuntimeCueManifest, base: string): { sequence: unknown; cues: Record<string, ResolvedCue> } {
  const doors = line.pack.doors as { sequence?: unknown; [key: string]: unknown } | undefined;
  if (!doors?.sequence) throw new Error(`Door sequence missing for ${String(line.pack.id)}`);
  const cues: Record<string, ResolvedCue> = {};
  for (const [part, value] of Object.entries(doors)) {
    if (part === 'sequence' || !value || typeof value !== 'object' || !('file' in value)) continue;
    const role = doorRoles[part];
    if (!role) throw new Error(`Unknown Subway door cue role: ${part}`);
    cues[part] = resolveCue(value as PackCueRecord, role, catalogue, base);
  }
  return { sequence: doors.sequence, cues };
}

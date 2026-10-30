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

import type { RunSnapshot } from '../simulation/run';
import type { RunEffect } from '../simulation/run-state';
import type { MotionAudioInstance, ResolvedCue, TrainMotionApi } from './sound-types';
import { loadSubwayMotionEngine } from './asset-loader';
import { playEmergencyAlert } from './audio-alert';
import { createCueBufferCache } from './audio-cache';
import { effectGain } from './audio-level';
import { subscribeSubwayMixerSettings } from './audio-volume';

const MOTION_CALIBRATION = 0.65;

type AudioProfile = { id?: string };

export type SubwayAudioStats = {
  activeSources: number;
  decodedCacheBytes: number;
  decodedCachePeakBytes: number;
  cacheHits: number;
  syntheticEmergencyAlert: true;
};

export type SubwayAudioOptions = {
  contextFactory?: () => AudioContext;
  loadEngine?: typeof loadSubwayMotionEngine;
  fetch?: typeof fetch;
  onAvailability?: (available: boolean) => void;
};

export interface SubwayAudioController {
  setEnabled(enabled: boolean, fromGesture?: boolean): void;
  resetLine(fromGesture?: boolean): void;
  setVisible(visible: boolean): void;
  setMix(volume: number, muted: boolean): void;
  setAnnouncementVolume(volume: number): void;
  transition(snapshot: RunSnapshot, effects: readonly RunEffect[]): void;
  preload(cues: readonly ResolvedCue[]): void;
  playCue(effect: Extract<RunEffect, { type: 'play-cue' }>): Promise<void>;
  getStats(): SubwayAudioStats;
  dispose(): void;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}

export function createSubwayAudio(options: SubwayAudioOptions = {}): SubwayAudioController {
  const makeContext = options.contextFactory ?? (() => new AudioContext());
  const loadEngine = options.loadEngine ?? loadSubwayMotionEngine;
  const fetchAsset = options.fetch ?? globalThis.fetch.bind(globalThis);
  let context: AudioContext | undefined;
  let cueBus: GainNode | undefined;
  let voiceBus: GainNode | undefined;
  let motion: MotionAudioInstance | undefined;
  let motionApi: TrainMotionApi | undefined;
  let enginePromise: ReturnType<typeof loadEngine> | undefined;
  let profilePromise: Promise<void> | undefined;
  let profileId: string | undefined;
  let currentLine = 'yamanote';
  let currentSnapshot: RunSnapshot | undefined;
  let enabled = false;
  let visible = false;
  let disposed = false;
  let epoch = 0;
  let profileEpoch = 0;
  let visibilityEpoch = 0;
  let audioGeneration = -1;
  let mixVolume = 1;
  let mixMuted = false;
  let announcementVolume = 0.8;
  let availabilityKnown: boolean | undefined;
  const buffers = createCueBufferCache({
    fetch: fetchAsset,
    context: () => context,
    disposed: () => disposed,
    warnOnce,
  });
  const activeSources = new Map<AudioScheduledSourceNode, string | undefined>();
  const failed = new Set<string>();
  const alerts = new Set<number>();

  function setAvailability(available: boolean) {
    if (availabilityKnown === available) return;
    availabilityKnown = available;
    options.onAvailability?.(available);
  }

  function smooth(param: AudioParam, value: number) {
    if (!context) return;
    const now = context.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, 0.015);
  }

  function applyGains(immediate = false) {
    if (!context || !cueBus || !voiceBus) return;
    const now = context.currentTime;
    const cue = visible && enabled && !mixMuted ? mixVolume : 0;
    const voice = cue * announcementVolume;
    if (immediate) {
      cueBus.gain.cancelScheduledValues(now);
      voiceBus.gain.cancelScheduledValues(now);
      cueBus.gain.setValueAtTime(cue, now);
      voiceBus.gain.setValueAtTime(voice, now);
    } else {
      smooth(cueBus.gain, cue);
      smooth(voiceBus.gain, voice);
    }
    motion?.volume(visible && enabled && !mixMuted ? mixVolume * MOTION_CALIBRATION : 0);
  }

  function ensureContext(): AudioContext | undefined {
    if (context || disposed || !enabled || !visible) return context;
    if (!options.contextFactory && typeof AudioContext === 'undefined') return undefined;
    try {
      context = makeContext();
      cueBus = context.createGain();
      voiceBus = context.createGain();
      voiceBus.connect(cueBus);
      cueBus.connect(context.destination);
      cueBus.gain.value = 0;
      voiceBus.gain.value = 0;
      applyGains(true);
      setAvailability(false);
      return context;
    } catch (error) {
      setAvailability(false);
      warnOnce('context', error);
      return undefined;
    }
  }

  function warnOnce(key: string, error: unknown) {
    if (failed.has(key)) return;
    failed.add(key);
    console.warn(`Subway audio unavailable (${key})`, error);
  }

  function stopSources() {
    for (const [source, url] of [...activeSources]) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
      source.disconnect();
      activeSources.delete(source);
      buffers.pin(url, -1);
    }
  }

  function ensureEngine(): Promise<{ api: TrainMotionApi; profiles: readonly unknown[] }> {
    if (!enginePromise)
      enginePromise = loadEngine()
        .then((loaded) => {
          motionApi = loaded.api;
          return loaded;
        })
        .catch((error) => {
          enginePromise = undefined;
          warnOnce('engine', error);
          throw error;
        });
    return enginePromise;
  }

  async function ensureMotion(line: string) {
    const audioContext = ensureContext();
    if (!audioContext || disposed) return;
    currentLine = line;
    const wanted = line === 'sakaisuji' ? 'osaka' : 'tokyo';
    if (motion && profileId === wanted) return;
    if (profilePromise && profileId === wanted) return profilePromise;
    const thisProfileEpoch = ++profileEpoch;
    const thisEpoch = epoch;
    motion?.dispose();
    motion = undefined;
    profileId = wanted;
    profilePromise = (async () => {
      try {
        const loaded = await ensureEngine();
        if (
          disposed ||
          thisEpoch !== epoch ||
          thisProfileEpoch !== profileEpoch ||
          audioContext !== context
        )
          return;
        const profile = loaded.profiles.find(
          (candidate) => (candidate as AudioProfile)?.id === wanted,
        );
        if (!profile) throw new Error(`Missing ${wanted} motion profile`);
        const instance = await loaded.api.MotionAudio.load(audioContext, profile);
        if (
          disposed ||
          thisEpoch !== epoch ||
          thisProfileEpoch !== profileEpoch ||
          audioContext !== context
        ) {
          instance.dispose();
          return;
        }
        motion = instance;
        applyGains(true);
        if (currentSnapshot && !currentSnapshot.paused)
          motion.update({
            speed: currentSnapshot.speed,
            power: currentSnapshot.power,
            brake: currentSnapshot.brake,
          });
        setAvailability(audioContext.state === 'running');
      } catch (error) {
        if (thisEpoch === epoch && thisProfileEpoch === profileEpoch) {
          setAvailability(false);
          warnOnce(`profile:${wanted}`, error);
        }
      } finally {
        if (thisProfileEpoch === profileEpoch) profilePromise = undefined;
      }
    })();
    return profilePromise;
  }

  function resumeContext(fromGesture: boolean) {
    if (!context || !visible || !enabled) return;
    if (context.state === 'running') return;
    try {
      const resumed = context.resume();
      void resumed
        .then(() => {
          if (context && enabled && visible) {
            applyGains(true);
            if (motion) setAvailability(true);
          }
        })
        .catch((error) => {
          setAvailability(false);
          warnOnce(fromGesture ? 'unlock' : 'resume', error);
        });
    } catch (error) {
      setAvailability(false);
      warnOnce(fromGesture ? 'unlock' : 'resume', error);
    }
  }

  function setEnabled(value: boolean, fromGesture = false) {
    if (disposed) return;
    if (enabled === value) {
      if (value && fromGesture && visible) {
        ensureContext();
        resumeContext(true);
        void ensureMotion(currentLine);
      }
      return;
    }
    enabled = value;
    if (!value) {
      epoch++;
      profileEpoch++;
      stopSources();
      motion?.dispose();
      motion = undefined;
      profileId = undefined;
      profilePromise = undefined;
      enginePromise = undefined;
      motionApi = undefined;
      const audioContext = context;
      context = undefined;
      cueBus?.disconnect();
      voiceBus?.disconnect();
      cueBus = undefined;
      voiceBus = undefined;
      buffers.clear();
      if (audioContext && audioContext.state !== 'closed')
        void audioContext.close().catch(() => {});
      setAvailability(false);
      return;
    }
    if (!visible) return;
    ensureContext();
    resumeContext(fromGesture);
    void ensureMotion(currentLine);
  }

  function resetLine(fromGesture = false) {
    if (!enabled) return;
    setEnabled(false);
    setEnabled(true, fromGesture);
  }

  function setVisible(value: boolean) {
    if (disposed || visible === value) return;
    visible = value;
    const request = ++visibilityEpoch;
    if (!enabled) return;
    if (!value) {
      if (!context) return;
      applyGains(true);
      const suspendedContext = context;
      void suspendedContext
        .suspend()
        .then(() => {
          if (visibilityEpoch !== request && visible && enabled && context === suspendedContext)
            resumeContext(false);
        })
        .catch((error) => warnOnce('suspend', error));
    } else {
      ensureContext();
      resumeContext(false);
      applyGains(true);
      if (currentSnapshot) transition(currentSnapshot, []);
      void ensureMotion(currentLine);
    }
  }

  function setMix(volume: number, muted: boolean) {
    mixVolume = clamp(volume);
    mixMuted = muted;
    applyGains();
  }

  function setAnnouncementVolume(volume: number) {
    announcementVolume = clamp(volume);
    applyGains();
  }

  function preload(cues: readonly ResolvedCue[]) {
    if (!enabled || !visible || !context) return;
    for (const cue of cues) void buffers.decode(cue);
  }

  function playAlert(generation: number) {
    if (!context || !cueBus || !enabled || !visible || mixMuted || alerts.has(generation)) return;
    alerts.add(generation);
    playEmergencyAlert(context, cueBus, activeSources);
  }

  function transition(snapshot: RunSnapshot, effects: readonly RunEffect[]) {
    currentSnapshot = snapshot;
    if (audioGeneration !== snapshot.generation) {
      audioGeneration = snapshot.generation;
      stopSources();
    }
    currentLine = snapshot.line;
    if (snapshot.immersion !== enabled) setEnabled(snapshot.immersion);
    if (enabled && visible && !snapshot.paused) {
      void ensureMotion(snapshot.line);
      motion?.update({ speed: snapshot.speed, power: snapshot.power, brake: snapshot.brake });
    }
    if (effects.some((effect) => effect.type === 'emergency') && !alerts.has(snapshot.generation)) {
      stopSources();
      playAlert(snapshot.generation);
    }
  }

  async function playCue(effect: Extract<RunEffect, { type: 'play-cue' }>) {
    const audioContext = context;
    let api = motionApi;
    const cueBusNode = cueBus;
    if (
      !enabled ||
      !visible ||
      !audioContext ||
      !cueBusNode ||
      effect.generation !== audioGeneration
    )
      return;
    const requestEpoch = epoch;
    const scheduledAt = audioContext.currentTime;
    if (!api) {
      try {
        api = (await ensureEngine()).api;
      } catch {
        return;
      }
    }
    if (
      disposed ||
      requestEpoch !== epoch ||
      !enabled ||
      !visible ||
      audioContext !== context ||
      effect.generation !== audioGeneration
    )
      return;
    const buffer = await buffers.decode(effect.cue);
    if (
      !buffer ||
      disposed ||
      !enabled ||
      !visible ||
      requestEpoch !== epoch ||
      effect.generation !== audioGeneration ||
      audioContext !== context
    )
      return;
    const elapsed = Math.max(0, audioContext.currentTime - scheduledAt);
    if (elapsed >= effect.cue.duration) return;
    const { role, offset, duration, gain } = effect.cue;
    const cue: ResolvedCue = {
      ...effect.cue,
      gain: role === 'voice' ? gain : effectGain(buffer, offset, duration, gain),
      offset: effect.cue.offset + elapsed,
      duration: effect.cue.duration - elapsed,
    };
    const destination = cue.role === 'voice' ? voiceBus : cueBusNode;
    if (!destination) return;
    try {
      const source = api.playCue(audioContext, destination, buffer, cue, audioContext.currentTime);
      activeSources.set(source, cue.url);
      buffers.pin(cue.url, 1);
      source.addEventListener(
        'ended',
        () => {
          activeSources.delete(source);
          buffers.pin(cue.url, -1);
          source.disconnect();
          buffers.prune();
        },
        { once: true },
      );
    } catch (error) {
      warnOnce(`play:${cue.url}`, error);
    }
  }

  function getStats(): SubwayAudioStats {
    const { bytes, peakBytes, hits } = buffers.stats();
    return {
      activeSources: activeSources.size,
      decodedCacheBytes: bytes,
      decodedCachePeakBytes: peakBytes,
      cacheHits: hits,
      syntheticEmergencyAlert: true,
    };
  }

  function dispose() {
    if (disposed) return;
    setEnabled(false);
    disposed = true;
    stopSources();
    unsubscribeMixer();
  }

  const unsubscribeMixer = subscribeSubwayMixerSettings((settings) =>
    setMix(settings.volume, settings.muted),
  );
  return {
    setEnabled,
    resetLine,
    setVisible,
    setMix,
    setAnnouncementVolume,
    transition,
    preload,
    playCue,
    getStats,
    dispose,
  };
}

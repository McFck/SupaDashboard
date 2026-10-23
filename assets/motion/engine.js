/* Motion audio follows the vehicle state; it never owns a station timetable. */
(function () {
  'use strict';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const EFFORT_SECONDS = 0.6; // full 0..1 effort change; tune by ear

  function curve(points, speed) {
    if (!points.length) return 0;
    if (points.length === 1) return points[0][1];
    let i = 0;
    while (i < points.length - 2 && points[i + 1][0] < speed) i++;
    const [x, y] = points[i], [nextX, nextY] = points[i + 1];
    return Math.max(0, y + (nextY - y) * (speed - x) / (nextX - x));
  }

  function validate(state) {
    for (const key of ['speed', 'power', 'brake']) {
      if (!Number.isFinite(state[key])) throw new TypeError(`Invalid ${key}`);
    }
    if (state.speed < 0 || state.power < 0 || state.power > 1 || state.brake < 0 || state.brake > 1)
      throw new RangeError('Speed must be positive; power and brake must be 0..1');
    if (state.power > 0 && state.brake > 0) throw new RangeError('Power and brake cannot be applied together');
  }

  function mix(profile, state) {
    validate(state);
    const {speed, power, brake} = state;
    const moving = clamp(speed / 0.7, 0, 1);
    return {
      motors: profile.motors.map(m => ({
        gain: moving * profile.motorGain * (power * curve(m.power, speed) + brake * curve(m.brake, speed)),
        // Rates for inaudible layers do not matter, but must remain positive for Web Audio.
        rate: Math.max(0.01, curve(brake > 0 ? m.brakeRate : m.powerRate, speed))
      })),
      rolling: {gain: profile.rolling.gain * clamp(speed / 60, 0, 1) * moving,
                rate: Math.max(0.01, speed / profile.rolling.referenceKmh)},
      shoe: {gain: (profile.shoe?.gain || 0) * brake * moving * clamp((8 - speed) / 5, 0, 1), rate: 1},
      idle: {gain: profile.idle?.gain || 0, rate: 1}
    };
  }

  // One event per real brake release. Loading or resetting a scene emits nothing.
  function releaseEvent(previous, current) {
    return Boolean(previous && previous.brake > 0 && current.brake === 0);
  }

  function demoState(t) {
    if (t < 2) return {speed: 0, power: 0, brake: 1, phase: 'Standing · brakes held'};
    if (t < 3) return {speed: 0, power: 0, brake: 0, phase: 'Brake release'};
    if (t < 23) return {speed: (t - 3) * 2.75, power: 0.85, brake: 0, phase: 'Accelerating'};
    if (t < 31) return {speed: 55 - (t - 23) * 0.3, power: 0, brake: 0, phase: 'Coasting · wheels keep rolling'};
    if (t < 38) return {speed: 52.6 + (t - 31) * (7.4 / 7), power: 0.6, brake: 0, phase: 'Power reapplied'};
    if (t < 42) return {speed: 60 - (t - 38) * 0.35, power: 0, brake: 0, phase: 'Coasting'};
    if (t < 62) return {speed: 58.6 * (62 - t) / 20, power: 0, brake: 0.75, phase: 'Braking to the platform'};
    return {speed: 0, power: 0, brake: 1, phase: 'Stopped · movement quiet'};
  }

  // Most BVE loops are cut to wrap seamlessly; crossfading those smears phase and dips the level each repeat.
  function seamless(buffer) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      let step = 0;
      for (let i = 1; i < data.length; i++) step += Math.abs(data[i] - data[i - 1]);
      if (Math.abs(data[0] - data[data.length - 1]) > 4 * step / (data.length - 1) + 1e-4) return false;
    }
    return true;
  }

  function blendLoop(context, buffer, seconds) {
    if (seamless(buffer)) return buffer;
    const overlap = Math.min(Math.floor(buffer.length / 4), Math.round(buffer.sampleRate * seconds));
    if (overlap < 2) return buffer;
    const length = buffer.length - overlap;
    const output = context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const input = buffer.getChannelData(channel), data = output.getChannelData(channel);
      data.set(input.subarray(overlap, length));
      for (let i = 0; i < overlap; i++) {
        const weight = (1 - Math.cos(Math.PI * i / (overlap - 1))) / 2;
        data[length - overlap + i] = input[length + i] * (1 - weight) + input[i] * weight;
      }
    }
    // The final frame now leads into the next original frame at the loop start.
    return output;
  }

  class MotionAudio {
    static async load(context, profile) {
      const entries = [...profile.motors, ...['rolling', 'shoe', 'idle', 'release'].filter(k => profile[k]).map(k => profile[k])];
      const buffers = new Map();
      await Promise.all(entries.map(async e => {
        const response = await fetch(e.url);
        if (!response.ok) throw new Error(`Could not load ${e.original}`);
        buffers.set(e.url, await context.decodeAudioData(await response.arrayBuffer()));
      }));
      return new MotionAudio(context, profile, buffers);
    }

    constructor(context, profile, buffers) {
      this.context = context;
      this.profile = profile;
      this.buffers = buffers;
      this.previous = null;
      this.effort = null;
      this.disposed = false;
      this.events = new Set();
      this.master = context.createGain();
      this.master.gain.value = 0.65;
      this.limiter = context.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.master.connect(this.limiter).connect(context.destination);
      this.motors = profile.motors.map(e => this.loop(e, 0.05));
      for (const key of ['rolling', 'shoe', 'idle']) if (profile[key])
        this[key] = this.loop(profile[key], key === 'rolling' ? 0.12 : 0.06);
    }

    loop(entry, overlap) {
      const source = this.context.createBufferSource();
      source.buffer = blendLoop(this.context, this.buffers.get(entry.url), overlap);
      source.loop = true;
      const gain = this.context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.master);
      source.start(this.context.currentTime);
      return {source, gain};
    }

    // setTargetAtTime chases the new value from wherever the parameter is. cancelAndHoldAtTime
    // with linear ramps briefly dropped every layer to silence in Chrome.
    smooth(param, value) {
      param.setTargetAtTime(value, this.context.currentTime, 0.015);
    }

    // Traction and brake effort build and decay like a jerk-limited controller instead of
    // switching motor sound on/off; one must reach zero before the other builds.
    slew(state) {
      const now = this.context.currentTime;
      if (!this.effort) {
        this.effort = {power: state.power, brake: state.brake, time: now};
        return {...state};
      }
      const step = clamp(now - this.effort.time, 0, 0.25) / EFFORT_SECONDS;
      const move = (from, to) => Math.abs(to - from) <= step + 1e-9 ? to : from + Math.sign(to - from) * step;
      const e = this.effort;
      if (state.brake > 0 && e.power > 0) e.power = move(e.power, 0);
      else if (state.power > 0 && e.brake > 0) e.brake = move(e.brake, 0);
      else {e.power = move(e.power, state.power); e.brake = move(e.brake, state.brake);}
      e.time = now;
      return {speed: state.speed, power: e.power, brake: e.brake};
    }

    volume(value) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Volume must be 0..1');
      this.smooth(this.master.gain, value);
    }

    update(state) {
      if (this.disposed) return;
      validate(state);
      const levels = mix(this.profile, this.slew(state));
      const apply = (layer, value) => {
        this.smooth(layer.gain.gain, value.gain);
        this.smooth(layer.source.playbackRate, value.rate);
      };
      this.motors.forEach((layer, i) => apply(layer, levels.motors[i]));
      for (const key of ['rolling', 'shoe', 'idle']) if (this[key]) apply(this[key], levels[key]);
      if (releaseEvent(this.previous, state) && this.profile.release) this.release();
      this.previous = {...state};
    }

    release() {
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = this.buffers.get(this.profile.release.url);
      gain.gain.value = this.profile.release.gain;
      source.connect(gain).connect(this.master);
      this.events.add(source);
      source.onended = () => {this.events.delete(source); source.disconnect(); gain.disconnect();};
      source.start(this.context.currentTime);
    }

    reset() {
      this.previous = null;
      this.effort = null;
      for (const event of this.events) event.stop();
      this.update({speed: 0, power: 0, brake: 1});
    }

    dispose() {
      this.disposed = true;
      for (const layer of [...this.motors, ...['rolling', 'shoe', 'idle'].map(k => this[k]).filter(Boolean)]) {
        layer.source.stop(); layer.source.disconnect(); layer.gain.disconnect();
      }
      for (const event of this.events) event.stop();
      this.master.disconnect(); this.limiter.disconnect();
    }
  }

  // Recorded cues carry their recording's background noise; fade it so it never switches on/off.
  function playCue(context, destination, buffer, cue, when) {
    const source = context.createBufferSource(), gain = context.createGain();
    const end = when + cue.duration, fadeIn = Math.min(0.04, cue.duration / 4), fadeOut = Math.min(cue.fadeOut ?? 0.25, cue.duration / 3);
    source.buffer = buffer;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(cue.gain, when + fadeIn);
    gain.gain.setValueAtTime(cue.gain, end - fadeOut);
    gain.gain.linearRampToValueAtTime(0, end);
    source.connect(gain).connect(destination);
    source.onended = () => gain.disconnect();
    source.start(when, cue.offset, cue.duration);
    return source;
  }

  const api = {curve, mix, releaseEvent, demoState, blendLoop, playCue, MotionAudio};
  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.TrainMotion = api;
})();

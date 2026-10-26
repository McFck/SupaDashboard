import type { ControlConfig } from '../controls/model';
import {
  mediaSourceKey,
  readMediaOptions,
  sameMediaSource,
  stepSlide,
  type MediaSource,
} from './content';

export class ContentController {
  private readonly state = new Map<string, { slide: number; reload: number }>();
  private readonly sources = new Map<string, MediaSource[]>();
  private readonly positions = new Map<string, { source: string; time: number }>();

  constructor(private readonly onChange: () => void) {}

  snapshot() {
    return Object.fromEntries(this.state);
  }

  command(control: ControlConfig, command: 'next' | 'prev' | 'goto' | 'reload', index?: number) {
    const current = this.state.get(control.id) ?? { slide: 0, reload: 0 };
    let next: { slide: number; reload: number };
    if (
      control.type === 'media' &&
      (command === 'next' || command === 'prev' || command === 'goto')
    ) {
      const options = readMediaOptions(control.options);
      if (command === 'goto') {
        if (
          index === undefined ||
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= options.sources.length
        ) {
          throw new Error('Media slide is unavailable');
        }
        next = { ...current, slide: index };
      } else {
        next = {
          ...current,
          slide: stepSlide(
            current.slide,
            options.sources.length,
            command === 'next' ? 1 : -1,
            options.loop,
          ),
        };
      }
    } else if (control.type === 'web' && command === 'reload') {
      next = { ...current, reload: current.reload + 1 };
    } else {
      throw new Error('Content command is not supported by this target');
    }
    if (next.slide === current.slide && next.reload === current.reload) {
      return false;
    }
    this.positions.delete(control.id);
    this.state.set(control.id, next);
    this.onChange();
    return true;
  }

  rememberVideoPosition(control: ControlConfig, source: string, time: number) {
    if (
      !Number.isFinite(time) ||
      time < 0 ||
      control.type !== 'media' ||
      !readMediaOptions(control.options).sources.some((entry) => mediaSourceKey(entry) === source)
    ) {
      return;
    }
    this.positions.set(control.id, { source, time });
  }

  videoPosition(controlId: string, source: string) {
    const saved = this.positions.get(controlId);
    return saved?.source === source ? saved.time : undefined;
  }

  reconcile(controls: readonly ControlConfig[], placed: ReadonlySet<string>) {
    const current = new Set(controls.map((control) => control.id));
    for (const entries of [this.state, this.sources, this.positions]) {
      for (const id of entries.keys()) {
        if (!current.has(id) || !placed.has(id)) {
          entries.delete(id);
        }
      }
    }
    for (const control of controls) {
      if (control.type !== 'media' || !placed.has(control.id)) {
        continue;
      }
      const sources = readMediaOptions(control.options).sources;
      const previous = this.sources.get(control.id);
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(sources)) {
        const state = this.state.get(control.id);
        const priorIndex = state?.slide ?? 0;
        const priorSource = previous[priorIndex];
        let nextIndex = priorSource
          ? sources.findIndex((source) => sameMediaSource(source, priorSource))
          : -1;
        if (nextIndex < 0) {
          nextIndex = Math.min(priorIndex, Math.max(0, sources.length - 1));
        }
        if (mediaSourceKey(priorSource) !== mediaSourceKey(sources[nextIndex])) {
          this.positions.delete(control.id);
        }
        if (state && state.slide !== nextIndex) {
          this.state.set(control.id, { ...state, slide: nextIndex });
        }
      }
      this.sources.set(control.id, sources);
    }
  }

  dispose() {
    this.state.clear();
    this.sources.clear();
    this.positions.clear();
  }
}

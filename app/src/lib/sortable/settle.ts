import { tick } from 'svelte';
import { SPRING_SAMPLES } from '../spring';
import { restoreStyle, type SortSession, type StyleSnapshot } from './session';

/** Below this many pixels the dropped item is already where it was held. */
const SETTLED_DISTANCE = 0.5;
const MIN_DURATION = 160;
const MAX_DURATION = 260;

/** Owns the pending render, drop animation and style restoration until a new press or teardown. */
export class DropSettlement {
  private token = 0;
  private animation: Animation | null = null;
  private settling: { item: HTMLElement; style: StyleSnapshot } | null = null;

  get item() {
    return this.settling?.item;
  }

  cancel() {
    this.token++;
    const animation = this.animation;
    this.animation = null;
    animation?.cancel();
    if (this.settling) {
      restoreStyle(this.settling.item, this.settling.style);
    }
    this.settling = null;
  }

  /** Wait for the caller's reorder to render before measuring the destination slot. */
  play(current: Pick<SortSession, 'source' | 'styles' | 'axis' | 'reducedMotion'>, held: DOMRect) {
    const token = ++this.token;
    void tick().then(() => {
      const source = current.source;
      const original = current.styles.get(source);
      if (token !== this.token || !source.isConnected || !original || current.reducedMotion) {
        return;
      }
      // Spring from where the item was held to its new slot, keeping the item's own transform.
      const { axis } = current;
      const final = source.getBoundingClientRect();
      const offset = axis === 'x' ? held.left - final.left : held.top - final.top;
      if (Math.abs(offset) < SETTLED_DISTANCE) {
        return;
      }
      const transform = original.transform;
      const translate = (px: number) =>
        `translate${axis.toUpperCase()}(${px}px)${transform ? ` ${transform}` : ''}`;
      source.style.transition = 'none';
      source.style.transform = translate(offset);
      void source.getBoundingClientRect();
      const duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, 160 + Math.abs(offset) * 0.2));
      const animation = source.animate(
        [
          { transform: translate(offset), offset: 0 },
          ...SPRING_SAMPLES.slice(1).map((sample) => ({
            transform: translate(offset * (1 - sample.progress)),
            offset: sample.offset,
          })),
          { transform: transform || 'none', offset: 1 },
        ],
        { duration, fill: 'both' },
      );
      this.settling = { item: source, style: original };
      this.animation = animation;
      void animation.finished
        .then(() => {
          if (this.animation !== animation) {
            return;
          }
          this.animation = null;
          restoreStyle(source, original);
          this.settling = null;
          animation.cancel();
        })
        .catch(() => {});
    });
  }
}

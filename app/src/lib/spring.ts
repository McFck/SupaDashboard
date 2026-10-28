// The shared underdamped spring used for drag returns, reorders and disclosure motion.
const SPRING_DAMPING = 0.82;
const SPRING_OMEGA = 20;
const SPRING_OMEGA_D = SPRING_OMEGA * Math.sqrt(1 - SPRING_DAMPING ** 2);

/** Underdamped spring response over elapsed seconds. */
export function springProgress(t: number) {
  if (!Number.isFinite(t) || t <= 0) {
    return 0;
  }
  return (
    1 -
    Math.exp(-SPRING_DAMPING * SPRING_OMEGA * t) *
      (Math.cos(SPRING_OMEGA_D * t) +
        (SPRING_DAMPING / Math.sqrt(1 - SPRING_DAMPING ** 2)) * Math.sin(SPRING_OMEGA_D * t))
  );
}

/** Shared normalized spring samples; the final frame is exact even if the curve has a tiny residual. */
export const SPRING_SAMPLES = Array.from({ length: 32 }, (_, i) => ({
  offset: i / 31,
  progress: i === 31 ? 1 : springProgress((0.52 * i) / 31),
}));

/** Longer rejected drags get a longer return, capped to keep the interaction responsive. */
export function springDuration(distanceInScreenPx: number) {
  const distance = Number.isFinite(distanceInScreenPx) ? Math.max(0, distanceInScreenPx) : 0;
  return Math.max(360, Math.min(520, 320 + 0.25 * distance));
}

/** Translation-only returns share the curve; callers own timing, cancellation and reduced motion. */
export function springTranslate(
  node: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: KeyframeAnimationOptions,
) {
  return node.animate(
    SPRING_SAMPLES.map(({ offset, progress }) => ({
      offset,
      transform: `translate3d(${from.x + (to.x - from.x) * progress}px, ${from.y + (to.y - from.y) * progress}px, 0)`,
    })),
    options,
  );
}

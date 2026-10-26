import { emit, listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';

type RemovalRegistration = { node: HTMLElement; onStart?: () => void };
const nodes = new Map<string, Set<RemovalRegistration>>();
const pending = new Map<string, Promise<void>>();
const finished = new WeakSet<HTMLElement>();

export function registerRemovalNode(node: HTMLElement, id: string, onStart?: () => void) {
  const group = nodes.get(id) ?? new Set<RemovalRegistration>();
  const registration = { node, onStart };
  group.add(registration);
  nodes.set(id, group);
  return {
    destroy() {
      group.delete(registration);
      if (!group.size) nodes.delete(id);
    },
  };
}

export function dustParticles(
  width: number,
  height: number,
  colors: string[],
  random = Math.random,
) {
  const step = Math.max(6, Math.sqrt((width * height) / 900));
  const particles = [];
  for (let y = step / 2; y < height; y += step)
    for (let x = step / 2; x < width; x += step) {
      particles.push({
        x,
        y,
        vx: 15 + random() * 65,
        vy: -12 - random() * 50,
        size: 1 + random() * 2.5,
        delay: (x / Math.max(1, width)) * 0.15,
        color: colors[Math.floor(random() * colors.length)] ?? '#8ea8f0',
      });
    }
  return particles;
}

function dissolve(node: HTMLElement): Promise<void> {
  if (finished.has(node) || !node.isConnected) return Promise.resolve();
  finished.add(node);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const tile = node.querySelector<HTMLElement>('.tile') ?? node;
  const rect = tile.getBoundingClientRect();
  const accent = getComputedStyle(tile).getPropertyValue('--accent').trim() || '#8ea8f0';
  // Read the visual samples once, before the canvas animation starts.
  const samples = [...tile.querySelectorAll<HTMLElement>('svg, span')]
    .filter(
      (element) =>
        element.matches('svg') || (!element.children.length && element.textContent?.trim()),
    )
    .map((element) => ({
      rect: element.getBoundingClientRect(),
      color: getComputedStyle(element).color,
    }));
  const particles = dustParticles(rect.width, rect.height, ['#151923', '#1c1f26', accent, accent]);
  for (const particle of particles) {
    const sample = samples.find(
      (s) =>
        particle.x + rect.left >= s.rect.left &&
        particle.x + rect.left <= s.rect.right &&
        particle.y + rect.top >= s.rect.top &&
        particle.y + rect.top <= s.rect.bottom,
    );
    if (sample) particle.color = sample.color;
  }
  const margin = 90,
    ratio = Math.min(devicePixelRatio, 2);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = `position:fixed;pointer-events:none;z-index:10000;left:${rect.left - margin}px;top:${rect.top - margin}px;width:${rect.width + margin * 2}px;height:${rect.height + margin * 2}px`;
  canvas.width = Math.ceil((rect.width + margin * 2) * ratio);
  canvas.height = Math.ceil((rect.height + margin * 2) * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve();
  ctx.scale(ratio, ratio);
  document.body.append(canvas);
  const fade = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' });
  node.style.pointerEvents = 'none';
  const start = performance.now();
  return new Promise((resolve) => {
    function draw(now: number) {
      const progress = Math.min(1, (now - start) / 620);
      ctx!.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
      for (const p of particles) {
        const t = Math.max(0, (progress - p.delay) / (1 - p.delay));
        ctx!.globalAlpha = (1 - t) ** 1.7 * Math.min(1, progress * 12);
        ctx!.fillStyle = p.color;
        ctx!.fillRect(
          margin + p.x + p.vx * t,
          margin + p.y + p.vy * t + 16 * t * t,
          p.size,
          p.size,
        );
      }
      if (progress < 1) requestAnimationFrame(draw);
      else {
        canvas.remove();
        node.style.opacity = '0';
        fade.cancel();
        resolve();
      }
    }
    requestAnimationFrame(draw);
  });
}

/** Play dust, then let the caller checkpoint and remove the item. Safe to call more than once. */
export function animateRemoval(itemId: string, broadcast = true): Promise<void> {
  const existing = pending.get(itemId);
  if (existing) return existing;
  // The other window plays the same dust at the same time instead of dropping the tile when settings sync.
  if (broadcast && isTauri()) void emit('item-removing', itemId).catch(() => {});
  const registrations = [...(nodes.get(itemId) ?? [])];
  for (const registration of registrations) {
    try {
      registration.onStart?.();
    } catch {
      /* One grid must not prevent the other removal views from stopping. */
    }
  }
  const animation = Promise.all(registrations.map(({ node }) => dissolve(node))).then(() => {});
  pending.set(itemId, animation);
  void animation.finally(() => pending.delete(itemId));
  return animation;
}

/** Mirror removals started in another window. */
export function followRemovals() {
  if (!isTauri()) return () => {};
  const stop = listen<string>('item-removing', (event) => {
    void animateRemoval(event.payload, false);
  });
  return () => {
    void stop.then((unlisten) => unlisten());
  };
}

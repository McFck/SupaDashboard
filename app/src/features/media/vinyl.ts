// Generative vinyl: the same artist and title always press the same record. Geometry is in viewBox units (0..100).

const SEED_VERSION = 'v1';
const CACHE_SIZE = 32;
/** Akira tokens: capsule red, muted teal, off-white and warm greys. */
const LABEL_COLOURS = ['#d42c26', '#b8322c', '#3cc7c0', '#f2ece6', '#a39a91', '#2a2522'];
const ACCENT_COLOURS = ['#d42c26', '#3cc7c0', '#f2ece6'];

export type Groove = { r: number; width: number; opacity: number };
export type LabelArc = { d: string; width: number; colour: string };
export type VinylDesign = {
  grooves: Groove[];
  accent: { cx: number; cy: number; r: number; colour: string };
  label: { r: number; colour: string; ink: string };
  arcs: LabelArc[];
  /** Faint light catching the grooves: the only detail that shows the turn when the cover hides the label. */
  marks: LabelArc[];
};

/** FNV-1a 32-bit over UTF-8 bytes. Decorative only: never an identity or a cache security key. */
function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}

/** mulberry32; a zero seed would be valid but is replaced so the idle record is a fixed design. */
function random(seed: number) {
  let state = seed || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

function arcPath(r: number, from: number, sweep: number) {
  const point = (angle: number) =>
    `${round(50 + r * Math.cos(angle))} ${round(50 + r * Math.sin(angle))}`;
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${point(from)} A ${r} ${r} 0 ${large} 1 ${point(from + sweep)}`;
}

function press(seed: number): VinylDesign {
  const next = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  const labelR = 13 + next() * 5;
  const grooves: Groove[] = [];
  // Bands of tight grooves separated by a few wider gaps, like tracks on a side.
  const gaps = Array.from({ length: 2 + Math.floor(next() * 3) }, () => labelR + 5 + next() * 28);
  for (let r = labelR + 3; r < 48; r += 0.85 + next() * 0.5) {
    if (gaps.some((at) => Math.abs(at - r) < 0.7)) {
      continue;
    }
    grooves.push({
      r: round(r),
      width: round(0.18 + next() * 0.22),
      opacity: round(0.05 + next() * 0.12),
    });
  }
  const accentR = labelR + 6 + next() * (40 - labelR);
  const drift = 0.4 + next() * 0.8;
  const angle = next() * Math.PI * 2;
  const labelColour = pick(LABEL_COLOURS);
  const ink = labelColour === '#f2ece6' || labelColour === '#a39a91' ? '#171412' : '#f2ece6';
  const arcs = Array.from({ length: 2 + Math.floor(next() * 4) }, () => ({
    d: arcPath(round(4 + next() * (labelR - 6)), next() * Math.PI * 2, 0.5 + next() * 2.6),
    width: round(0.5 + next() * 1.1),
    colour: next() < 0.75 ? ink : pick(ACCENT_COLOURS),
  }));
  const marks = Array.from({ length: 3 + Math.floor(next() * 3) }, () => ({
    d: arcPath(
      round(labelR + 5 + next() * (42 - labelR)),
      next() * Math.PI * 2,
      0.3 + next() * 0.9,
    ),
    width: round(0.4 + next() * 0.6),
    colour: '#f2ece6',
  }));
  return {
    grooves,
    marks,
    accent: {
      cx: round(50 + Math.cos(angle) * drift),
      cy: round(50 + Math.sin(angle) * drift),
      r: round(accentR),
      colour: pick(ACCENT_COLOURS),
    },
    label: { r: round(labelR), colour: labelColour, ink },
    arcs,
  };
}

const cache = new Map<string, VinylDesign>();

/** The record for a track. Case is kept; both fields absent give the idle record. */
export function vinylDesign(title = '', artist = '') {
  const seed = `${SEED_VERSION}:${JSON.stringify([artist.normalize('NFC').trim(), title.normalize('NFC').trim()])}`;
  const hit = cache.get(seed);
  if (hit) {
    cache.delete(seed);
    cache.set(seed, hit);
    return hit;
  }
  const design = press(title.trim() || artist.trim() ? fnv1a(seed) : 0);
  cache.set(seed, design);
  if (cache.size > CACHE_SIZE) {
    const [oldest] = cache.keys();
    cache.delete(oldest);
  }
  return design;
}

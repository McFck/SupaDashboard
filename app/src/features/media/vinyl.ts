// Generative vinyl: the same artist and title always press the same record. Geometry is in viewBox units (0..100).

const SEED_VERSION = 'v3';
const CACHE_SIZE = 32;
const IVORY = '#f2ece6';
const BLACK = '#141110';
const HOLE = '#0f0d0c';
/** Akira tokens: capsule red, off-white and warm greys; teal stays an accent. */
const LABEL_COLOURS = ['#d42c26', '#b8322c', IVORY, '#a39a91', '#2a2522'];
const LIGHT_LABELS = [IVORY, '#a39a91'];
const ACCENT_COLOURS = ['#d42c26', '#3cc7c0', IVORY];
/** Body colour first, then pigments. Teal is one palette in six so it stays occasional. */
const PALETTES = [
  ['#7d1f1b', '#d42c26', IVORY, '#3b1512'],
  ['#d42c26', IVORY, '#8f1d1a', BLACK],
  ['#e9e1d6', '#d42c26', '#2a2522', '#a39a91'],
  ['#1c2a29', '#3cc7c0', IVORY, '#0f1716'],
  ['#2a2522', '#a39a91', '#d42c26', IVORY],
  ['#a8492a', '#e3a165', IVORY, '#4f2014'],
];
const STYLES = [
  'black',
  'etched',
  'translucent',
  'marble',
  'swirl',
  'splatter',
  'split',
  'picture',
  'bands',
] as const;

type Shape = { d: string; fill?: string; stroke?: string; width?: number; opacity: number };
type Ring = { r: number; width: number; colour: string; opacity: number };
type Text = { y: number; size: number; content: string; colour: string };
type Body = { base: string; under: Shape[]; rings: Ring[]; over: Shape[] };
export type VinylDesign = Body & { text: Text[] };
type Next = () => number;

/** FNV-1a 32-bit over UTF-8 bytes. Decorative only: never an identity or a cache security key. */
function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}

/** mulberry32; a zero seed would be valid but is replaced so the idle record is a fixed design. */
function random(seed: number): Next {
  let state = seed || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const TURN = Math.PI * 2;
const round = (value: number) => Math.round(value * 100) / 100;
const pick = <T>(next: Next, list: readonly T[]) => list[Math.floor(next() * list.length)];
const at = (r: number, angle: number) =>
  `${round(50 + r * Math.cos(angle))} ${round(50 + r * Math.sin(angle))}`;

/** A full circle of radius size whose centre sits at (r, angle) from the record's centre. */
function dot(size: number, r = 0, angle = 0) {
  const s = round(size);
  return `M ${at(r, angle)} m ${-s} 0 a ${s} ${s} 0 1 0 ${round(2 * s)} 0 a ${s} ${s} 0 1 0 ${round(-2 * s)} 0`;
}

function arc(r: number, from: number, sweep: number) {
  return `M ${at(r, from)} A ${round(r)} ${round(r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${at(r, from + sweep)}`;
}

/** An annular sector; an inner radius of 0 makes a wedge from the centre. */
function sector(inner: number, outer: number, from: number, sweep: number) {
  const large = sweep > Math.PI ? 1 : 0;
  const back = inner
    ? `L ${at(inner, from + sweep)} A ${round(inner)} ${round(inner)} 0 ${large} 0 ${at(inner, from)}`
    : 'L 50 50';
  return `M ${at(outer, from)} A ${round(outer)} ${round(outer)} 0 ${large} 1 ${at(outer, from + sweep)} ${back} Z`;
}

/** A straight band across a circle of radius r between offsets top and bottom (|offset| < r), turned by angle. */
function band(r: number, top: number, bottom: number, angle: number) {
  const a = Math.asin(top / r);
  const b = Math.asin(bottom / r);
  const edge = `${round(r)} ${round(r)} 0 0 1`;
  return `M ${at(r, Math.PI - a + angle)} L ${at(r, a + angle)} A ${edge} ${at(r, b + angle)} L ${at(r, Math.PI - b + angle)} A ${edge} ${at(r, Math.PI - a + angle)} Z`;
}

/** Pigment stretched out from the centre as the record is pressed: an uneven radial streak. */
function streak(angle: number, inner: number, outer: number, spread: number) {
  const middle = (inner + outer) / 2;
  const point = (radius: number, offset: number) => at(radius, angle + offset * spread);
  return `M ${point(inner, 0)} C ${point(middle, -0.2)} ${point(outer * 0.94, -1)} ${point(outer, -0.45)} Q ${point(outer, 0.4)} ${point(outer * 0.9, 0.8)} C ${point(middle, 0.35)} ${point(inner + 3, 0.1)} ${point(inner, 0)} Z`;
}

/** Concentric grooves with a few wider, glossier gaps between tracks; density drifts track by track. */
function grooves(next: Next, from: number, to: number, opacity: number): Ring[] {
  const gaps = Array.from(
    { length: 2 + Math.floor(next() * 4) },
    () => from + 3 + next() * (to - from - 5),
  );
  const rings: Ring[] = gaps.map((r) => ({ r: round(r), width: 0.9, colour: IVORY, opacity }));
  let step = 0.7;
  for (let r = from; r < to && rings.length < 72; r += step * (0.85 + next() * 0.3)) {
    if (gaps.some((gap) => Math.abs(gap - r) < 0.8)) {
      step = 0.5 + next() * 0.7;
      continue;
    }
    const width = round(0.16 + next() * 0.24);
    rings.push({ r: round(r), width, colour: IVORY, opacity: round(opacity * (0.6 + next())) });
  }
  return rings;
}

function streaks(next: Next, pigments: string[], count: number, splatter: boolean): Shape[] {
  return Array.from({ length: count }, () => {
    const inner = splatter ? 20 + next() * 24 : 12 + next() * 22;
    const outer = splatter ? inner + 3 + next() * (46 - inner) : 40 + next() * 9;
    const spread = splatter ? 0.015 + next() * 0.075 : 0.12 + next() * 0.4;
    return {
      d: streak(next() * TURN, inner, outer, spread),
      fill: pick(next, pigments),
      opacity: round(splatter ? 0.4 + next() * 0.45 : 0.18 + next() * 0.4),
    };
  });
}

/** A ribbon spiralling out from the label, tapering at both ends. */
function arm(start: number, turn: number, width: number) {
  const edge = (side: number) =>
    Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      return at(16 + t * 32 + side * width * Math.sin(t * Math.PI), start + t * turn);
    });
  return `M ${edge(-1).join(' L ')} L ${edge(1).reverse().join(' L ')} Z`;
}

function picture(next: Next, ink: string[], angle: number): Shape[] {
  const kind = pick(next, ['sun', 'rays', 'halftone']);
  if (kind === 'sun') {
    const stripes = [0, 1, 2, 3, 4].map((i) => band(46, 4 + i * 6, 6.5 + i * 6.6, angle));
    return [
      {
        d: dot(16 + next() * 6, 14 + next() * 8, angle - Math.PI / 2),
        fill: ink[0],
        opacity: 0.95,
      },
      { d: stripes.join(' '), fill: ink[2], opacity: 0.85 },
    ];
  }
  if (kind === 'rays') {
    const count = 8 + 2 * Math.floor(next() * 5);
    const rays = Array.from({ length: count }, (_, i) =>
      sector(16, 46, angle + (i * TURN) / count, TURN / count / 2),
    );
    return [
      { d: rays.join(' '), fill: ink[0], opacity: 0.85 },
      { d: dot(6 + next() * 4, 31, angle), fill: ink[1], opacity: 0.9 },
    ];
  }
  const dots: string[] = [];
  for (let r = 19; r < 46; r += 4.5) {
    const count = Math.floor((r * TURN) / 4.5);
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * TURN;
      // Dot size follows a soft light falling across the disc, as in a halftone print.
      dots.push(dot(0.4 + 1.5 * (0.5 + 0.5 * Math.cos(a - angle)) * (1 - (r - 19) / 40), r, a));
    }
  }
  return [{ d: dots.join(' '), fill: ink[0], opacity: 0.9 }];
}

/** The etched run-out between the last groove and the label: a star polygon, ticks and a guide ring. */
function runout(next: Next): Shape[] {
  const points = 5 + Math.floor(next() * 8);
  const skip = Math.max(2, Math.floor(points / 2 - next() * 2));
  const r = 27 + next() * 2;
  const turn = next() * TURN;
  const star = Array.from({ length: points + 1 }, (_, i) =>
    at(r, turn + ((i * skip) % points) * (TURN / points)),
  );
  const tickCount = 24 + 12 * Math.floor(next() * 3);
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const a = (i / tickCount) * TURN;
    return `M ${at(29.6, a)} L ${at(i % 4 ? 30.2 : 30.7, a)}`;
  });
  const paint = { stroke: IVORY, opacity: 0.3 };
  return [
    { d: `M ${star.join(' L ')}`, width: 0.25, ...paint },
    { d: ticks.join(' '), width: 0.2, ...paint },
    { d: dot(21 + next() * 2), width: 0.15, ...paint },
  ];
}

function body(style: (typeof STYLES)[number], next: Next, palette: string[]): Body {
  const [base, ...pigments] = palette;
  const angle = next() * TURN;
  if (style === 'black' || style === 'etched') {
    return {
      base: pick(next, [BLACK, '#1b1715', '#221a18']),
      under: [],
      rings: grooves(next, style === 'etched' ? 31 : 21, 48, 0.13),
      over: style === 'etched' ? runout(next) : [],
    };
  }
  const under: Shape[] = [];
  const rings = grooves(next, 21, style === 'picture' ? 46 : 48, style === 'picture' ? 0.05 : 0.1);
  if (style === 'translucent') {
    // Depth faked with soft rings: lit near the label, darker towards the rim, with one bright wedge.
    rings.unshift(
      { r: 25, width: 20, colour: pigments[1], opacity: 0.14 },
      { r: 45, width: 9.2, colour: BLACK, opacity: 0.22 },
    );
    under.push({ d: sector(16, 47, angle, 0.5 + next() * 0.5), fill: IVORY, opacity: 0.08 });
  } else if (style === 'marble' || style === 'splatter') {
    under.push(...streaks(next, pigments, style === 'marble' ? 26 : 60, style === 'splatter'));
    for (const colour of style === 'splatter' ? pigments.slice(0, 2) : []) {
      const drops = Array.from({ length: 6 }, () =>
        dot(0.4 + next() * 1.2, 18 + next() * 29, next() * TURN),
      );
      under.push({ d: drops.join(' '), fill: colour, opacity: 0.8 });
    }
  } else if (style === 'swirl') {
    const turn = (next() < 0.5 ? 1 : -1) * (2 + next() * 2.5);
    const count = 5 + Math.floor(next() * 3);
    for (let i = 0; i < count; i += 1) {
      const d = arm(angle + (i * TURN) / count, turn, 2 + next() * 4);
      under.push({ d, fill: pigments[i % 3], opacity: round(0.35 + next() * 0.4) });
    }
  } else if (style === 'split') {
    const colours = pick(next, [
      [base, pigments[0]],
      [pigments[0], pigments[2]],
      [base, pigments[0], pigments[2]],
    ]);
    // Halves, quarters or thirds.
    const parts = colours.length === 3 ? 3 : pick(next, [2, 2, 4]);
    for (let i = 0; i < parts; i += 1) {
      const fill = colours[i % colours.length];
      under.push({
        d: sector(0, 49.6, angle + (i * TURN) / parts, TURN / parts),
        fill,
        opacity: 1,
      });
      // Where two pellets meet the colours bleed into each other.
      const seam = streak(angle + (i * TURN) / parts, 14 + next() * 10, 44 + next() * 5, 0.1);
      under.push({ d: seam, fill: pick(next, pigments), opacity: 0.3 });
    }
  } else if (style === 'picture') {
    under.push(...picture(next, pigments, angle));
    rings.push({ r: 47.8, width: 3.6, colour: '#d9d2c8', opacity: 0.22 });
  } else {
    // Akira bands: bold concentric rings in alternating pigments with the grooves laid over them.
    for (let r = 18, i = 0; r < 46; i += 1) {
      const width = Math.min(2 + next() * 7, 49.6 - r);
      if (i % 2 === 0) {
        const colour = pigments[(i >> 1) % 3];
        rings.unshift({ r: round(r + width / 2), width: round(width), colour, opacity: 0.92 });
      }
      r += width + 0.6;
    }
  }
  return { base, under, rings, over: [] };
}

/** A mirrored line mark on a 3x3 grid, like a small label logo. */
function glyph(next: Next, cy: number, size: number) {
  const point = (x: number, y: number) => `${round(50 + x * size)} ${round(cy + y * size)}`;
  const edges = [
    [-1, -1, 0, -1],
    [-1, 0, 0, 0],
    [-1, 1, 0, 1],
    [-1, -1, -1, 0],
    [-1, 0, -1, 1],
    [0, -1, 0, 0],
    [0, 0, 0, 1],
    [-1, -1, 0, 0],
    [-1, 0, 0, 1],
    [-1, 0, 0, -1],
    [-1, 1, 0, 0],
  ];
  return edges
    .filter(() => next() < 0.32)
    .flatMap(([x1, y1, x2, y2]) => [
      `M ${point(x1, y1)} L ${point(x2, y2)}`,
      `M ${point(-x1, y1)} L ${point(-x2, y2)}`,
    ])
    .join(' ');
}

function label(next: Next) {
  const hole = pick(next, ['spindle', 'spindle', 'ringed', 'wide', 'spider'] as const);
  const single = hole === 'wide' || hole === 'spider';
  const r = round(single ? 16 + next() * 3 : 13 + next() * 5);
  const holeR = { spindle: 1.3, ringed: 1.3, wide: 3.8, spider: 5.6 }[hole];
  const colour = pick(next, LABEL_COLOURS);
  const ink = LIGHT_LABELS.includes(colour) ? '#171412' : IVORY;
  const accent = pick(
    next,
    ACCENT_COLOURS.filter((c) => c !== colour),
  );
  const over: Shape[] = [{ d: dot(r), fill: colour, opacity: 1 }];
  const text: Text[] = [];
  const kind = pick(next, ['rings', 'stripes', 'split', 'arcs']);
  if (kind === 'rings') {
    const rings = Array.from({ length: 1 + Math.floor(next() * 3) }, (_, i) =>
      dot(r - 1.2 - i * (0.9 + next() * 1.4)),
    );
    over.push({ d: rings.join(' '), stroke: ink, width: 0.3, opacity: 0.7 });
  } else if (kind === 'stripes') {
    const angle = next() < 0.5 ? 0 : Math.PI / 2;
    const top = -r * (0.2 + next() * 0.5);
    over.push({ d: band(r, top, top + 1 + next() * 1.6, angle), fill: accent, opacity: 0.9 });
    over.push({ d: band(r, r * 0.55, r * 0.55 + 0.6, angle), fill: ink, opacity: 0.6 });
  } else if (kind === 'split') {
    over.push({ d: sector(0, r, next() * TURN, Math.PI), fill: accent, opacity: 0.85 });
  } else {
    const arcs = Array.from({ length: 2 + Math.floor(next() * 3) }, () =>
      arc(4 + next() * (r - 6), next() * TURN, 0.5 + next() * 2.6),
    );
    over.push({ d: arcs.join(' '), stroke: ink, width: round(0.5 + next() * 0.8), opacity: 0.85 });
  }
  const room = (r + holeR) / 2;
  if (next() < 0.65) {
    const d = glyph(next, 50 - room, Math.min(2.2, (r - holeR) / 5));
    over.push({ d, stroke: ink, width: 0.45, opacity: 0.9 });
  }
  if (next() < 0.7) {
    const catalogue = `SPD-${Math.floor(next() * 9000) + 1000}`;
    const side = `SIDE ${next() < 0.5 ? 'A' : 'B'} · ${single ? '45' : '33⅓'}`;
    text.push(
      { y: round(50 + room - 0.4), size: 1.7, content: catalogue, colour: ink },
      { y: round(50 + room + 1.6), size: 1.1, content: side, colour: ink },
    );
  }
  if (hole === 'ringed') {
    over.push({ d: dot(2.6), stroke: ink, width: 0.35, opacity: 0.6 });
  }
  over.push({ d: dot(holeR), fill: HOLE, opacity: 1 });
  if (hole === 'spider') {
    // The three-spoke adaptor that seats a 45 on a standard spindle.
    const spokes = [0, 1, 2].map((i) => sector(2.2, holeR + 0.2, (i * TURN) / 3, 0.55));
    const fill = pick(next, ['#d42c26', IVORY, '#3b3431']);
    over.push({ d: [...spokes, dot(2.4)].join(' '), fill, opacity: 1 });
    over.push({ d: dot(0.9), fill: HOLE, opacity: 1 });
  }
  return { over, text };
}

function press(seed: number): VinylDesign {
  const next = random(seed);
  const style = seed ? pick(next, STYLES) : 'black';
  const surface = body(style, next, pick(next, PALETTES));
  // Faint light catching the grooves: the only detail that shows the turn when the cover hides the label.
  const marks = Array.from({ length: 3 + Math.floor(next() * 3) }, () =>
    arc(24 + next() * 22, next() * TURN, 0.3 + next() * 0.9),
  );
  const accent = dot(28 + next() * 16, 0.4 + next() * 0.8, next() * TURN);
  const centre = label(next);
  return {
    ...surface,
    over: [
      ...surface.over,
      { d: marks.join(' '), stroke: IVORY, width: 0.6, opacity: 0.14 },
      { d: accent, stroke: pick(next, ACCENT_COLOURS), width: 0.35, opacity: 0.5 },
      ...centre.over,
    ],
    text: centre.text,
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

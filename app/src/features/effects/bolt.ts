type Point = { x: number; y: number };

// Jagged walk between two points in the 0..100 tile box; the end point is exact.
function walk(from: Point, to: Point, steps: number, jitter: number): Point[] {
  const points = [from];
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const sway = step < steps ? (Math.random() - 0.5) * jitter : 0;
    points.push({
      x: from.x + (to.x - from.x) * t + sway,
      y: from.y + (to.y - from.y) * t + sway * 0.25,
    });
  }
  return points;
}

const toPath = (points: Point[]) =>
  points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

/** A branching strike that starts inside the tile near `originX` (0..1) and reaches the bottom edge. */
export function strikePath(originX: number) {
  const start = { x: 22 + originX * 56, y: 5 };
  const main = walk(start, { x: start.x + (Math.random() - 0.5) * 44, y: 101 }, 11, 13);
  const branches = [3, 5, 7].map((at, k) => {
    const from = main[at];
    const side = (k % 2 ? 1 : -1) * (Math.random() < 0.5 ? 1 : -1);
    return walk(
      from,
      { x: from.x + side * (16 + Math.random() * 18), y: from.y + 20 + Math.random() * 22 },
      5,
      8,
    );
  });
  return { x: start.x, paths: [main, ...branches].map(toPath) };
}

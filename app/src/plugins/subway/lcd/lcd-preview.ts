// Dev-only page: renders one LCD state from URL params for screenshot comparison against reference photos.
import { normalizeSubwayLines } from '../lines';
import { scheduleScreen, type ScreenPage } from '../screens';
import type { RunPhase, RunSnapshot } from '../run';
import { drawYamanoteLCD } from './yamanote';

const q = new URLSearchParams(location.search);
const get = (id: string) => Promise.all(['line', 'pack'].map(f => fetch(`/subway/lines/${id}/${f}.json`).then(r => r.json())));
const bundles = await Promise.all(['yamanote', 'hibiya', 'sakaisuji'].map(async id => { const [line, pack] = await get(id); return { line, pack }; }));
const yamanote = normalizeSubwayLines(bundles)[0];
const snapshot: RunSnapshot = { line: 'yamanote', station: q.get('station') ?? 'JY20', next: q.get('next') ?? 'JY19',
  direction: q.get('dir') ?? 'outer', state: (q.get('state') ?? 'cruising') as RunPhase, doors: (q.get('doors') ?? 'closed') as RunSnapshot['doors'], doorSide: 'left',
  remainingMinutes: 60, speed: 40, progress: .4, power: 0, brake: 0, paused: false, immersion: false, generation: 1, multiplier: 1 };
const lang = q.get('lang') ?? 'en';
let model = scheduleScreen(snapshot, { line: yamanote, languages: [lang], clock: '12:43' }, 0);
const want = q.get('page') as ScreenPage | null;
for (let t = 0; want && model.page !== want && t < 120_000; t += 500) model = scheduleScreen(snapshot, { line: yamanote, languages: [lang], clock: '12:43' }, t);
const canvas = document.getElementById('c') as HTMLCanvasElement;
// ?w=960 renders at NextStation's native 960x540 for 1:1 diffs against its own output.
const W = Number(q.get('w') ?? 1280), H = W * 9 / 16;
const dpr = devicePixelRatio; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const ctx = canvas.getContext('2d')!; ctx.scale(dpr * W / 1280, dpr * W / 1280);
await document.fonts.ready;
drawYamanoteLCD(ctx, model, Number(q.get('t') ?? 600));
(window as any).__lcdReady = model.page;

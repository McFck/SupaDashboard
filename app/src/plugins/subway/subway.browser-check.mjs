import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cdp = process.env.SUBWAY_CDP_URL ?? 'http://127.0.0.1:9337';
const base = process.env.SUBWAY_VITE_URL ?? 'http://127.0.0.1:5183';
const outputRoot = process.argv[2] ?? process.env.BB_THREAD_STORAGE;
if (!outputRoot) throw new Error('Pass the Subway thread-storage directory as the first argument');
const output = path.join(outputRoot, process.argv[3] ?? 'subway-increment-4');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

await mkdir(output, { recursive: true });
const pages = await (await fetch(`${cdp}/json/list`)).json();
const target = pages.find(page => page.type === 'page');
assert(target, `No isolated page target at ${cdp}`);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

let sequence = 0;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    consoleErrors.push(`${details.text}: ${details.exception?.description ?? ''} at ${details.url ?? ''}:${details.lineNumber ?? ''}`);
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map(argument => argument.value ?? argument.description ?? '').join(' '));
  } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    consoleErrors.push(message.params.entry.text);
  } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
    failedRequests.push({ url: message.params.response.url, status: message.params.response.status });
  } else if (message.method === 'Network.loadingFailed') {
    failedRequests.push({ requestId: message.params.requestId, error: message.params.errorText });
  }
};

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

await call('Runtime.discardConsoleEntries');
await call('Runtime.enable');
await call('Log.enable');
await call('Page.enable');
await call('Network.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: `${base}/subway.browser.html` });
for (let attempt = 0; attempt < 120; attempt++) {
  await pause(100);
  if (await evaluate('!!window.__subwayHarness')) break;
}
const mounted = await evaluate('!!window.__subwayHarness');
if (!mounted) {
  const body = await evaluate('document.body?.innerText ?? document.documentElement?.innerHTML ?? ""');
  throw new Error(`Subway browser harness did not mount: ${JSON.stringify({ body, consoleErrors, failedRequests })}`);
}
await evaluate('document.fonts.ready');

const manifest = await evaluate('window.__subwayHarness.manifest');
assert(manifest.length >= 58, `Expected all three line fixtures, got ${manifest.length}`);
const ids = new Set();
const captures = [];
let panelCrops = 0;
for (const fixture of manifest) {
  assert(!ids.has(fixture.id), `Duplicate fixture id ${fixture.id}`);
  ids.add(fixture.id);
  const [width, height] = fixture.logicalSize.split('x').map(Number);
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const report = await evaluate(`window.__subwayHarness.render(${JSON.stringify(fixture.id)})`);
  assert.equal(report.id, fixture.id);
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(output, `${fixture.id}.png`), Buffer.from(shot.data, 'base64'));
  if (report.line === 'hibiya') {
    for (const [name, x] of [['panel-a', 0], ['panel-b', 1312]]) {
      const crop = await call('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: true,
        clip: { x, y: 0, width: 1280, height: 720, scale: 1 },
      });
      await writeFile(path.join(output, `${fixture.id}-${name}.png`), Buffer.from(crop.data, 'base64'));
      panelCrops++;
    }
  }
  captures.push(report);
}

const ordinaryStates = ['stopped', 'doorsClosing', 'departing', 'cruising', 'approaching', 'arriving'];
for (const state of ordinaryStates) assert(captures.some(capture => capture.state === state), `Missing ${state} state capture`);
assert(captures.some(capture => capture.state === 'emergency'), 'Missing emergency capture');
assert(captures.some(capture => capture.state === 'suspended'), 'Missing suspension capture');
for (const page of ['platform', 'closing', 'nearby', 'broad', 'transfers', 'emergency', 'suspension'])
  assert(captures.some(capture => capture.page === page), `Missing ${page} page capture`);
assert(captures.some(capture => capture.direction === 'outer'), 'Missing outer-direction capture');
assert(captures.some(capture => capture.sideLabel === 'this side'), 'Missing this-side capture');
assert(captures.some(capture => capture.sideLabel === 'opposite side'), 'Missing opposite-side capture');
assert(captures.some(capture => capture.sideLabel === null), 'Missing unknown-side capture');
assert(captures.some(capture => capture.facilityCount === 0), 'Missing empty-facility capture');
assert(captures.some(capture => capture.facilityCount > 0), 'Missing synthetic-facility capture');
const hibiyaCaptures = captures.filter(capture => capture.line === 'hibiya');
for (const state of [...ordinaryStates, 'emergency', 'suspended'])
  assert(hibiyaCaptures.some(capture => capture.state === state), `Missing Hibiya ${state} state capture`);
for (const page of ['platform', 'closing', 'nearby', 'broad', 'transfers', 'emergency', 'suspension'])
  assert(hibiyaCaptures.some(capture => capture.page === page), `Missing Hibiya ${page} page capture`);
assert(hibiyaCaptures.some(capture => capture.direction === 'to-naka-meguro'), 'Missing Hibiya reverse direction');
assert(hibiyaCaptures.some(capture => capture.sideLabel === 'this side'), 'Missing Hibiya this-side fixture');
assert(hibiyaCaptures.some(capture => capture.sideLabel === 'opposite side'), 'Missing Hibiya opposite-side fixture');
assert(hibiyaCaptures.some(capture => capture.sideLabel === null), 'Missing Hibiya unknown-side fixture');
assert.equal(panelCrops, hibiyaCaptures.length * 2, 'Every Hibiya composite needs both panel crops');
const panelLanguages = new Set(hibiyaCaptures.flatMap(capture => capture.panelLanguages ?? []));
for (const language of ['ja', 'kana', 'en', 'zh', 'ko']) assert(panelLanguages.has(language), `Missing Hibiya ${language} language capture`);
const sakaisujiCaptures = captures.filter(capture => capture.line === 'sakaisuji');
assert.equal(sakaisujiCaptures.length, 21, 'Missing Sakaisuji fixture coverage');
for (const capture of sakaisujiCaptures) assert.equal(capture.logicalSize, '1920x540');
for (const state of [...ordinaryStates, 'emergency', 'suspended'])
  assert(sakaisujiCaptures.some(capture => capture.state === state), `Missing Sakaisuji ${state} state capture`);
for (const page of ['platform', 'closing', 'nearby', 'broad', 'transfers', 'emergency', 'suspension'])
  assert(sakaisujiCaptures.some(capture => capture.page === page), `Missing Sakaisuji ${page} page capture`);
for (const station of ['K11', 'K12', 'K20'])
  assert(sakaisujiCaptures.some(capture => capture.station === station), `Missing Sakaisuji ${station} fixture`);
assert(sakaisujiCaptures.some(capture => capture.direction === 'northbound'), 'Missing Sakaisuji northbound fixture');
assert(sakaisujiCaptures.some(capture => capture.sideLabel === 'this side'), 'Missing Sakaisuji this-side fixture');
assert(sakaisujiCaptures.some(capture => capture.sideLabel === 'opposite side'), 'Missing Sakaisuji opposite-side fixture');
assert(sakaisujiCaptures.some(capture => capture.sideLabel === null), 'Missing Sakaisuji unknown-side fixture');
assert(sakaisujiCaptures.some(capture => capture.language === 'kana'), 'Missing Sakaisuji kana fixture');

await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await evaluate('window.__subwayHarness.startStaticProbe()');
await pause(2_100);
await evaluate('window.__subwayHarness.updateWidgetOnly(50)');
const metrics = await evaluate('window.__subwayHarness.metrics()');
assert.deepEqual(metrics.staticProbe, { requests: 1, executed: 1, cancelled: 0, pending: 0, draws: 1 });
assert.equal(metrics.widgetOnlyUpdates, 50);
assert.equal(consoleErrors.length, 0, `Browser console errors: ${consoleErrors.join(' | ')}`);
assert.equal(failedRequests.length, 0, `Browser failed requests: ${JSON.stringify(failedRequests)}`);

const report = {
  browser: `owned isolated headless Chrome via CDP ${new URL(cdp).port}, muted`,
  vite: base,
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  nativeVisibility: 'simulated by the isolated browser harness',
  captures,
  hibiyaPanelCrops: panelCrops,
  metrics,
  consoleErrors,
};
await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify({ fixtures: manifest, captures }, null, 2)}\n`, 'utf8');
await writeFile(path.join(output, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, captures: captures.length, hibiyaPanelCrops: panelCrops, metrics }, null, 2));
await evaluate('window.__subwayHarness.stopStaticProbe()');
socket.close();

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  url: { type: 'string', default: process.env.R4_URL ?? 'http://127.0.0.1:5177/' },
  'cdp-port': { type: 'string', default: process.env.R4_CDP_PORT },
  artifacts: { type: 'string', default: process.env.R4_ARTIFACT_DIR ?? path.join(os.tmpdir(), 'r4-canvas-browser-check') },
} });

const origin = new URL(values.url).origin;
const artifactDir = path.resolve(values.artifacts);
fs.mkdirSync(artifactDir, { recursive: true });

const fixture = {
  version: 3, skin: 'deck',
  display: { monitor: null, fullscreen: false, background: { color: '#0a0a0a', opacity: .55, radius: 28 } },
  controls: [
    { id: 'swap', name: 'Swap', type: 'button', gestures: { swipeDown: { variant: 'next' }, swipeUp: { variant: 'prev' } },
      variants: [{ label: 'Swap A', icon: 'SkipBack', color: '#67c9eb' }, { label: 'Swap B', icon: 'SkipForward', color: '#66ce8f' }] },
    { id: 'one', name: 'One', type: 'button', gestures: { swipeDown: { variant: 'next' } },
      variants: [{ label: 'One A', icon: 'Circle', color: '#67c9eb' }, { label: 'One B', icon: 'CircleCheck', color: '#66ce8f' }] },
    { id: 'action', name: 'Action', type: 'button', gestures: { swipeRight: { id: 'media.toggle', args: { source: 'system' } } },
      variants: [{ label: 'Action', icon: 'Play', color: '#e9c878' }] },
    { id: 'blockerA', name: 'Blocker A', type: 'button', variants: [{ label: 'A', icon: 'Circle', color: '#67c9eb' }] },
    { id: 'blockerB', name: 'Blocker B', type: 'button', variants: [{ label: 'B', icon: 'Circle', color: '#67c9eb' }] },
    { id: 'slider', name: 'Vertical slider', type: 'slider', gestures: { swipeLeft: { variant: 'next' }, swipeRight: { variant: 'prev' } },
      variants: [{ label: 'System', icon: 'Volume2', color: '#8ea8f0', value: { id: 'volume', args: { target: 'system' } } },
        { label: 'Spotify', icon: 'Volume2', color: '#66ce8f', value: { id: 'volume', args: { target: 'spotify' } } }] },
    { id: 'sliderH', name: 'Horizontal slider', type: 'slider', gestures: { swipeUp: { variant: 'next' }, swipeDown: { variant: 'prev' } },
      variants: [{ label: 'System H', icon: 'Volume2', color: '#8ea8f0', value: { id: 'volume', args: { target: 'system' } } },
        { label: 'Spotify H', icon: 'Volume2', color: '#66ce8f', value: { id: 'volume', args: { target: 'spotify' } } }] },
    { id: 'mixer', name: 'Mixer', type: 'mixer', variants: [{ label: 'Mixer', color: '#b5a0e8' }],
      options: { channels: ['system', 'chrome', 'spotify', 'discord', 'teams', 'steam'].map(target => ({ target })), max: 6, layout: 'auto' } },
  ],
  deck: { rows: 6, cols: 12, size: 112, sizing: 'auto', gap: 14, items: [
    { id: 'swap-item', control: 'swap', x: 0, y: 0, w: 1, h: 2 },
    { id: 'one-item', control: 'one', x: 9, y: 0, w: 1, h: 1 },
    { id: 'action-item', control: 'action', x: 5, y: 0, w: 1, h: 1 },
    { id: 'slider-item', control: 'slider', x: 7, y: 0, w: 1, h: 3 },
    { id: 'mixer-item', control: 'mixer', x: 10, y: 0, w: 2, h: 2 },
    { id: 'blocker-a-item', control: 'blockerA', x: 4, y: 2, w: 1, h: 1 },
    { id: 'blocker-b-item', control: 'blockerB', x: 5, y: 2, w: 1, h: 1 },
    { id: 'sliderH-item', control: 'sliderH', x: 4, y: 4, w: 3, h: 1 },
  ] },
  variants: {},
};

const setup = `(() => {
  if (window.__canvasRegressionSetup) return;
  window.__canvasRegressionSetup = true;
  const key = 'supadashboard:settings:v4';
  const fixture = ${JSON.stringify(fixture)};
  localStorage.setItem(key, JSON.stringify(fixture));
  const nativeSet = Storage.prototype.setItem;
  window.__canvasSettingsWrites = [];
  Storage.prototype.setItem = function(name, value) {
    if (name === key) window.__canvasSettingsWrites.push({ time: performance.now(), value: JSON.parse(value) });
    return nativeSet.call(this, name, value);
  };
  window.__canvasActions = [];
  window.__audioUpdates = [];
  window.__audioState = { revision: 1, deviceId: 'test-device', channels: [
    { target: 'system', volume: .65, muted: false }, { target: 'spotify', volume: .4, muted: false },
    { target: 'chrome', volume: .6, muted: false }, { target: 'discord', volume: .55, muted: false },
    { target: 'teams', volume: .5, muted: false }, { target: 'steam', volume: .45, muted: false },
  ] };
  window.__volumeInitActive = false;
  Object.defineProperty(globalThis, 'isTauri', { configurable: true, get() {
    return window.__volumeInitActive && (new Error().stack || '').includes('initVolumeSync');
  } });
  window.__pointer = { id: null, x: 0, y: 0 };
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
    document.addEventListener(type, event => { window.__pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, type: event.type, buttons: event.buttons }; }, true);
  window.__volumeDispose = null;
  const add = window.addEventListener;
  window.addEventListener = function(type, listener, ...rest) {
    if (type === 'beforeunload' && (new Error().stack || '').includes('volume.ts')) window.__volumeDispose = listener;
    return add.call(this, type, listener, ...rest);
  };
  window.__workerStats = { created: 0, active: 0, requests: 0, replies: 0, terminated: 0 };
  window.__delayNextWorkerPost = false;
  window.__injectBeforeWorkerReply = false;
  const NativeWorker = window.Worker;
  function TrackedWorker(...args) {
    const worker = new NativeWorker(...args);
    const stats = window.__workerStats;
    const timers = new Set();
    stats.created++; stats.active++;
    const addListener = worker.addEventListener.bind(worker);
    worker.addEventListener = (type, listener, ...rest) => {
      if (type !== 'message') return addListener(type, listener, ...rest);
      const wrapped = event => {
        stats.replies++;
        if (window.__injectBeforeWorkerReply) {
          window.__injectBeforeWorkerReply = false;
          window.__workerRaceInjected = true;
          const target = document.querySelector('[aria-label="Move or select Action"]');
          if (target && window.__pointer.id != null) target.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerId: window.__pointer.id, clientX: window.__pointer.x,
            clientY: window.__pointer.y, buttons: 1,
          }));
        }
        return typeof listener === 'function' ? listener.call(worker, event) : listener.handleEvent(event);
      };
      return addListener(type, wrapped, ...rest);
    };
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (message, ...rest) => {
      stats.requests++;
      if (!window.__delayNextWorkerPost) return post(message, ...rest);
      window.__delayNextWorkerPost = false;
      const timer = setTimeout(() => { timers.delete(timer); try { post(message, ...rest); } catch {} }, 450);
      timers.add(timer);
    };
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      if (worker.__canvasTerminated) return;
      worker.__canvasTerminated = true;
      stats.active--; stats.terminated++;
      return terminate();
    };
    return worker;
  }
  TrackedWorker.prototype = NativeWorker.prototype;
  window.Worker = TrackedWorker;
  window.__frameCallbacks = new Map();
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    const stack = new Error().stack || '';
    let id;
    id = raf(time => { window.__frameCallbacks.delete(id); callback(time); });
    window.__frameCallbacks.set(id, stack);
    return id;
  };
  window.cancelAnimationFrame = id => { window.__frameCallbacks.delete(id); return caf(id); };
  window.__readyRace = false;
  window.__readyRaceInjected = 0;
  window.__enableReadyRace = () => {
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => {
      const stack = new Error().stack || '';
      if (window.__readyRace && stack.includes('markPreviewReady')) {
        window.__readyRace = false;
        return original(time => {
          window.__readyRaceInjected++;
          const target = document.querySelector('[aria-label="Move or select Action"]');
          if (target && window.__pointer.id != null) target.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerId: window.__pointer.id, clientX: window.__pointer.x,
            clientY: window.__pointer.y, buttons: 1,
          }));
          callback(time);
        });
      }
      return original(callback);
    };
  };
  globalThis.__TAURI_INTERNALS__ = {
    transformCallback(callback) { globalThis.__canvasCallbacks ??= new Map(); const id = globalThis.__canvasCallbacks.size + 1; globalThis.__canvasCallbacks.set(id, callback); return id; },
    unregisterCallback(id) { globalThis.__canvasCallbacks?.delete(id); },
    invoke: async (command, args = {}) => {
      if (command === 'plugin:event|listen') return 1;
      if (command === 'plugin:event|unlisten') return;
      if (command === 'audio_snapshot') return structuredClone(window.__audioState);
      if (command === 'audio_update') {
        window.__audioUpdates.push(structuredClone(args));
        window.__audioState.revision++;
        const channel = window.__audioState.channels.find(item => item.target === args.target);
        if (channel && args.value !== undefined) channel.volume = args.value;
        if (channel && args.muted !== undefined) channel.muted = args.muted;
        return { applied: !!channel, snapshot: structuredClone(window.__audioState) };
      }
      if (command === 'media_command') { window.__canvasActions.push(args); return; }
      return null;
    },
  };
})();`;

const cdpPort = values['cdp-port'] ? Number(values['cdp-port']) : null;
assert.ok(Number.isInteger(cdpPort) && cdpPort > 0 && cdpPort !== 9223 && cdpPort !== 9224, 'CDP port must be an owned port, not the live app');

let ws;
let id = 0;
const pending = new Map();
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { browser: '', origin, cdpPort, viewport: {}, fixture: 'version-3 localStorage fixture migrated to v4', artifacts: [], regressions: {} };

async function main() {
  let pages;
  for (let i = 0; i < 120; i++) {
    try { pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); break; }
    catch { await delay(100); }
  }
  assert.ok(pages, 'Owned headless Chrome CDP did not start');
  ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) {
      const task = pending.get(message.id); pending.delete(message.id);
      message.error ? task.reject(new Error(`${task.method}: ${message.error.message}`)) : task.resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { method, resolve, reject });
    ws.send(JSON.stringify({ id: requestId, method, params }));
    setTimeout(() => { if (pending.has(requestId)) { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); } }, 15000);
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const nextFrame = () => evaluate('new Promise(resolve => requestAnimationFrame(() => resolve()))');
  const waitFor = async (selector, timeout = 12000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${selector}: ${await evaluate('document.body.innerText')}`);
  };
  const viewport = async (width, height, deviceScaleFactor = 1) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
    report.viewport[`${width}x${height}@${deviceScaleFactor}`] = true;
    await delay(150);
  };
  const mouse = (type, x, y, buttons = type === 'mouseReleased' ? 0 : 1) => send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons,
    ...(type === 'mousePressed' || type === 'mouseReleased' ? { clickCount: 1 } : {}),
  });
  const pointerMove = (selector, x, y) => evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target || window.__pointer.id == null) throw new Error('Missing captured pointer target: ' + ${JSON.stringify(selector)});
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: window.__pointer.id,
      pointerType: 'mouse', isPrimary: true, button: -1, buttons: 1, clientX: ${x}, clientY: ${y} }));
    return true;
  })()`);
  const shot = async name => {
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(artifactDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
    report.artifacts.push(file);
    return file;
  };
  const rect = selector => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
  const info = () => evaluate(`(() => { const g=document.querySelector('[style*="grid-template-columns"]'); const s=getComputedStyle(g); const cell=parseFloat(s.gridTemplateColumns); const gap=parseFloat(s.gap); const r=g.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,cell,gap,pitch:cell+gap}; })()`);
  const settings = () => evaluate(`JSON.parse(localStorage.getItem('supadashboard:settings:v4') ?? 'null')`);
  const workerStats = () => evaluate('({ ...window.__workerStats, pendingPointerFrames: [...window.__frameCallbacks.values()].filter(s => s.includes("DeckGrid") || s.includes("track (") || s.includes("markPreviewReady")).length, actions: window.__canvasActions.length, audioUpdates: window.__audioUpdates.length, settingsWrites: window.__canvasSettingsWrites.length - (window.__canvasWriteBaseline ?? 0) })');
  const waitGridStable = async () => {
    let previous = await info(), stable = 0;
    for (let index = 0; index < 16 && stable < 5; index++) {
      await delay(80);
      const current = await info();
      stable = ['x', 'y', 'width', 'height', 'cell', 'gap'].every(key => Math.abs(current[key] - previous[key]) < .01) ? stable + 1 : 0;
      previous = current;
    }
    assert.ok(stable >= 5, 'Deck metrics did not settle before the interaction');
    await delay(250);
    return previous;
  };
  const setupPanel = async (width = 1440, height = 900) => {
    await viewport(width, height);
    await send('Page.navigate', { url: `${origin}/?view=panel` });
    await waitFor('button[aria-label="Empty spot 12,6"]');
    await evaluate(`document.querySelector('nav button[aria-label="Layout"]')?.click()`);
    await waitFor('[aria-label="Move or select Action"]');
    await delay(180);
    await waitGridStable();
    await evaluate('window.__canvasWriteBaseline=window.__canvasSettingsWrites.length');
  };
  const actionBox = () => rect('[aria-label="Move or select Action"]');
  const dragItem = async ({ label = 'Action', dx, dy = 0, samples = 10, race = null, delayPost = false, startAt = [.5, .5], detours = [], screenshotPrefix }) => {
    const handle = `[aria-label="Move or select ${label}"]`;
    const box = await rect(handle);
    assert.ok(box, `Missing move surface for ${label}`);
    const grab = { x: box.width * startAt[0], y: box.height * startAt[1] };
    const from = { x: box.x + grab.x, y: box.y + grab.y };
    const writesBefore = (await workerStats()).settingsWrites;
    if (screenshotPrefix) await shot(`${screenshotPrefix}-before`);
    if (race === 'ready') await evaluate('window.__readyRace=true;window.__enableReadyRace()');
    if (race === 'worker') await evaluate('window.__injectBeforeWorkerReply=true');
    if (delayPost) await evaluate('window.__delayNextWorkerPost=true');
    await mouse('mousePressed', from.x, from.y);
    const size = await info();
    const drift = [];
    for (let index = 1; index <= samples; index++) {
      const point = { x: from.x + size.pitch * dx * index / samples, y: from.y + size.pitch * dy * index / samples };
      await pointerMove(handle, point.x, point.y);
      await nextFrame();
      const current = await rect(handle);
      drift.push({ error: Math.hypot(current.x + grab.x - point.x, current.y + grab.y - point.y),
        point, anchor: { x: current.x + grab.x, y: current.y + grab.y }, rect: current });
    }
    for (const detour of detours) {
      await pointerMove(handle, from.x + size.pitch * detour.dx, from.y + size.pitch * (detour.dy ?? 0));
      await delay(detour.wait ?? 120);
    }
    if (screenshotPrefix) await shot(`${screenshotPrefix}-held`);
    const shown = await evaluate(`(() => { const target=document.querySelector('[data-placement-target]'); return target ? target.style.translate : null; })()`);
    const displaced = await evaluate(`([...document.querySelectorAll('[data-displaced-destination]')].map(el=>el.style.translate))`);
    await delay(160);
    const preReleaseStats = await workerStats();
    const pointer = { x: from.x + size.pitch * dx, y: from.y + size.pitch * dy };
    await mouse('mouseReleased', pointer.x, pointer.y, 0);
    await delay(500);
    if (screenshotPrefix) await shot(`${screenshotPrefix}-committed`);
    const stats = await workerStats();
    return { shown, displaced, drift, maxDrift: Math.max(...drift.map(sample => sample.error)), preReleaseStats, settingsWrites: stats.settingsWrites - writesBefore,
      stats, settings: await settings(), pointer };
  };
  const resetItem = async (id, expectedX, expectedY) => {
    const live = await settings();
    const item = live.deck.items.find(entry => entry.id === id);
    assert.equal(item.x, expectedX); assert.equal(item.y, expectedY);
  };
  const moveCounts = async () => evaluate(`({ writes: window.__canvasSettingsWrites.length, active: window.__workerStats.active, frames: [...window.__frameCallbacks.values()].filter(s => s.includes('DeckGrid') || s.includes('markPreviewReady')).length })`);
  const historyStatus = () => evaluate(`({canUndo:!document.querySelector('[aria-label="Undo"]').disabled,canRedo:!document.querySelector('[aria-label="Redo"]').disabled})`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: setup });
  await send('Page.navigate', { url: origin });
  await delay(150);
  report.browser = await evaluate('navigator.userAgent');

  // The deterministic readiness interleaving reproduces the stale-rAF regression.
  await setupPanel(1440, 900);
  const initial = await settings();
  assert.equal(initial.version, 3, 'The fixture must start at the legacy version');
  assert.ok(initial.deck.items.some(item => item.id === 'action-item'), `The v3 browser fixture did not load: ${JSON.stringify(initial.deck.items)}`);
  const free = await dragItem({ dx: 1, race: process.env.R4_SKIP_READY_RACE ? null : 'ready', screenshotPrefix: 'canvas-free-1440' });
  if (!process.env.R4_SKIP_READY_RACE) assert.equal(await evaluate('window.__readyRaceInjected'), 1, 'The readiness race injection did not run');
  assert.ok(free.maxDrift <= 1, `Free move anchor drift ${free.maxDrift}px exceeds 1px: ${JSON.stringify(free.drift)}`);
  assert.equal(free.settings.version, 4, 'The first persisted edit did not store migrated version-4 settings');
  const freeAction = free.settings.deck.items.find(item => item.id === 'action-item');
  assert.ok(freeAction, `Free move lost its item: ${JSON.stringify(free.settings.deck.items)}`);
  assert.equal(freeAction.x, 6, 'Free move did not commit the shown cell');
  assert.ok(free.shown, 'Free move had no displayed placement preview');
  assert.equal(free.settingsWrites, 1, `Free move made ${free.settingsWrites} settings writes`);
  assert.equal(free.stats.active, 0, 'A worker remained after free move teardown');
  assert.equal(free.stats.pendingPointerFrames, 0, 'A pointer callback remained after free move teardown');
  const historyAfterFree = await historyStatus();
  assert.equal(historyAfterFree.canUndo, true);
  report.regressions.freeMove = { maxAnchorErrorPx: free.maxDrift, shown: free.shown, x: 6,
    settingsWrites: free.settingsWrites, historyAfterCommit: historyAfterFree, workers: free.stats };
  await evaluate(`document.querySelector('[aria-label="Undo"]').click()`);
  await delay(300);
  await resetItem('action-item', 5, 0);
  assert.equal((await historyStatus()).canUndo, false, 'One undo did not remove the only move checkpoint');

  // Force the same callback order while an occupied target is being answered by the worker.
  await setupPanel(1440, 900);
  const occupied = await dragItem({ dx: 5, race: 'worker', screenshotPrefix: 'canvas-occupied-1440' });
  assert.ok(occupied.maxDrift <= 1, `Occupied move anchor drift ${occupied.maxDrift}px exceeds 1px`);
  assert.ok(occupied.stats.requests >= 1 && occupied.stats.replies >= 1, 'Occupied move did not use and complete the worker');
  assert.equal(occupied.stats.active, 0, 'Occupied move left a worker alive after release');
  assert.equal(occupied.stats.pendingPointerFrames, 0, 'Occupied move left a pointer callback pending');
  assert.equal(occupied.settings.deck.items.find(item => item.id === 'action-item').x, 10, 'Occupied move did not commit the target cell');
  assert.ok(occupied.shown, 'Occupied move released without a displayed preview');
  assert.equal(occupied.settingsWrites, 1, `Occupied move made ${occupied.settingsWrites} settings writes`);
  assert.equal(occupied.stats.actions, 0, 'Editing dispatched a scenario action');
  assert.equal(occupied.stats.audioUpdates, 0, 'Editing wrote an audio value');
  report.regressions.occupiedMove = { maxAnchorErrorPx: occupied.maxDrift, shown: occupied.shown, requests: occupied.stats.requests,
    replies: occupied.stats.replies, workersAfterRelease: occupied.stats.active, history: await historyStatus() };

  await setupPanel(1440, 900);
  const equalSwap = await dragItem({ dx: 4 });
  assert.equal(equalSwap.displaced.length, 1, `Equal-size target did not show a swap: ${JSON.stringify({ shown: equalSwap.shown, settings: equalSwap.settings.deck.items, requests: equalSwap.stats.requests, replies: equalSwap.stats.replies })}`);
  assert.equal(equalSwap.settings.deck.items.find(item => item.id === 'action-item').x, 9);
  assert.equal(equalSwap.settings.deck.items.find(item => item.id === 'one-item').x, 5);
  assert.equal(equalSwap.settingsWrites, 1);
  assert.equal(equalSwap.stats.active, 0);
  assert.equal(equalSwap.stats.pendingPointerFrames, 0);
  report.regressions.equalSwap = { displaced: equalSwap.displaced, settingsWrites: equalSwap.settingsWrites,
    actionX: 9, displacedItemX: 5, requests: equalSwap.stats.requests, replies: equalSwap.stats.replies };

  await setupPanel(1440, 900);
  const leftMove = await dragItem({ dx: -1 });
  assert.equal(leftMove.settings.deck.items.find(item => item.id === 'action-item').x, 4, `Leftward free move did not commit: ${JSON.stringify({ shown: leftMove.shown, drift: leftMove.drift, pointer: leftMove.pointer })}`);
  assert.equal(leftMove.settingsWrites, 1);
  assert.ok(leftMove.maxDrift <= 1);
  report.regressions.leftwardFreeMove = { x: 4, maxAnchorErrorPx: leftMove.maxDrift, settingsWrites: leftMove.settingsWrites };

  await setupPanel(1440, 900);
  const cachedTarget = await dragItem({ dx: 4, samples: 1, detours: [{ dx: 0, wait: 100 }, { dx: 4, wait: 140 }] });
  assert.equal(cachedTarget.stats.requests, 1, `Repeated target posted ${cachedTarget.stats.requests} worker jobs`);
  assert.equal(cachedTarget.stats.replies, 1, `Repeated target received ${cachedTarget.stats.replies} worker replies`);
  assert.equal(cachedTarget.settings.deck.items.find(item => item.id === 'action-item').x, 9);
  assert.equal(cachedTarget.settingsWrites, 1);
  report.regressions.cachedTarget = { requests: cachedTarget.stats.requests, replies: cachedTarget.stats.replies,
    settingsWrites: cachedTarget.settingsWrites, finalX: 9 };

  await setupPanel(1440, 900);
  const reentryBox = await actionBox(), reentryGrid = await info();
  const reentryFrom = { x: reentryBox.x + reentryBox.width / 2, y: reentryBox.y + reentryBox.height / 2 };
  const reentryTarget = { x: reentryFrom.x + reentryGrid.pitch, y: reentryFrom.y };
  await mouse('mousePressed', reentryFrom.x, reentryFrom.y);
  for (let i = 1; i <= 5; i++) { await pointerMove('[aria-label="Move or select Action"]', reentryFrom.x + reentryGrid.pitch * i / 5, reentryFrom.y); await delay(18); }
  await delay(60);
  const firstPreview = await evaluate('!!document.querySelector("[data-placement-target]")');
  await pointerMove('[aria-label="Move or select Action"]', reentryGrid.x - 30, reentryGrid.y - 30);
  await delay(60);
  const outsidePreview = await evaluate('!!document.querySelector("[data-placement-target]")');
  await pointerMove('[aria-label="Move or select Action"]', reentryTarget.x, reentryTarget.y);
  await delay(100);
  const returnedPreview = await evaluate('!!document.querySelector("[data-placement-target]")');
  assert.equal(firstPreview, true);
  assert.equal(outsidePreview, false, 'Leaving the deck retained an in-bounds preview');
  assert.equal(returnedPreview, true, 'Returning to the deck did not restore the preview');
  await mouse('mouseReleased', reentryTarget.x, reentryTarget.y, 0);
  await delay(500);
  const reentrySettings = await settings(), reentryStats = await workerStats();
  assert.equal(reentrySettings.deck.items.find(item => item.id === 'action-item').x, 6);
  assert.equal(reentryStats.settingsWrites, 1);
  assert.equal(reentryStats.pendingPointerFrames, 0);
  report.regressions.outsideReentry = { firstPreview, outsidePreview, returnedPreview,
    settingsWrites: reentryStats.settingsWrites, finalX: 6 };

  // A larger tile displaces two small blockers; the snapped preview and commit must agree.
  await setupPanel(1440, 900);
  const mixerBefore = await rect('[aria-label="Move or select Mixer"]');
  const gridBefore = await info();
  const mixerItem = (await settings()).deck.items.find(item => item.id === 'mixer-item');
  const mixerGrab = { x: mixerBefore.x + mixerBefore.width / 2, y: mixerBefore.y + mixerBefore.height / 2 };
  const targetPoint = { x: mixerGrab.x + gridBefore.pitch * (4 - mixerItem.x), y: mixerGrab.y + gridBefore.pitch * (2 - mixerItem.y) };
  await shot('canvas-multiblocker-before');
  await mouse('mousePressed', mixerGrab.x, mixerGrab.y);
  for (let i = 1; i <= 10; i++) { await pointerMove('[aria-label="Move or select Mixer"]', mixerGrab.x + (targetPoint.x - mixerGrab.x) * i / 10, mixerGrab.y + (targetPoint.y - mixerGrab.y) * i / 10); await delay(18); }
  await delay(180);
  const multiPreview = await evaluate(`(() => ({ target:document.querySelector('[data-placement-target]')?.style.translate,
    displaced:[...document.querySelectorAll('[data-displaced-destination]')].map(el=>el.style.translate) }))()`);
  assert.ok(multiPreview.target && multiPreview.displaced.length === 2, 'Large multi-blocker move did not show both displaced tiles');
  await shot('canvas-multiblocker-held');
  await mouse('mouseReleased', targetPoint.x, targetPoint.y, 0);
  const layoutBurst = await evaluate(`new Promise(resolve => {
    const started=performance.now();let frames=0,maxMarkerEscapePx=0,maxVisualUnmarkedAreaPx2=0,staleGridMarkers=0,noDragFailures=0;
    const sample=()=>{
      const roots=[...document.querySelectorAll('[style*="grid-area"]')].filter(root=>root.querySelector(':scope > [data-dashboard-tile]'));
      staleGridMarkers=0;
      for(const root of roots){
        if(root.hasAttribute('data-dashboard-tile'))staleGridMarkers++;
        const marker=root.querySelector(':scope > [data-dashboard-tile]');if(!marker)continue;
        const m=marker.getBoundingClientRect();
        if(getComputedStyle(marker).getPropertyValue('-webkit-app-region')!=='no-drag')noDragFailures++;
        for(const visual of marker.querySelectorAll('[data-dashboard-tile]')){
          const v=visual.getBoundingClientRect();if(!v.width||!v.height)continue;
          const escape=Math.max(0,m.x-v.x,m.y-v.y,v.x+v.width-m.x-m.width,v.y+v.height-m.y-m.height);
          maxMarkerEscapePx=Math.max(maxMarkerEscapePx,escape);
          const area=v.width*v.height,insideW=Math.max(0,Math.min(v.x+v.width,m.x+m.width)-Math.max(v.x,m.x));
          const insideH=Math.max(0,Math.min(v.y+v.height,m.y+m.height)-Math.max(v.y,m.y));
          maxVisualUnmarkedAreaPx2=Math.max(maxVisualUnmarkedAreaPx2,area-insideW*insideH);
        }
      }
      frames++;
      if(performance.now()-started<520)requestAnimationFrame(sample);
      else resolve({frames,maxMarkerEscapePx,maxVisualUnmarkedAreaPx2,staleGridMarkers,noDragFailures});
    };
    requestAnimationFrame(sample);
  })`);
  assert.ok(layoutBurst.frames >= 20, `Layout burst sampled only ${layoutBurst.frames} frames`);
  assert.ok(layoutBurst.maxMarkerEscapePx <= .5, `Transformed marker missed visual content by ${layoutBurst.maxMarkerEscapePx}px`);
  assert.ok(layoutBurst.maxVisualUnmarkedAreaPx2 <= .25, `Dashboard drag regions could overlap visual tiles by ${layoutBurst.maxVisualUnmarkedAreaPx2}px²`);
  assert.equal(layoutBurst.staleGridMarkers, 0, 'A structural grid slot retained a stale dashboard tile marker');
  assert.equal(layoutBurst.noDragFailures, 0, 'A transformed tile marker lost no-drag during its layout transition');
  await delay(450);
  await shot('canvas-multiblocker-committed');
  const multiSettings = await settings();
  const multiStats = await workerStats();
  assert.deepEqual(multiSettings.deck.items.find(item => item.id === 'mixer-item') && [multiSettings.deck.items.find(item => item.id === 'mixer-item').x, multiSettings.deck.items.find(item => item.id === 'mixer-item').y], [4, 2]);
  assert.equal(multiSettings.deck.items.filter(item => ['blocker-a-item', 'blocker-b-item'].includes(item.id)).length, 2);
  assert.equal(multiStats.settingsWrites, 1, `Multi-blocker move made ${multiStats.settingsWrites} settings writes`);
  report.regressions.multiBlocker = { preview: multiPreview, mixer: [4, 2], layoutBurst, settingsWrites: multiStats.settingsWrites };

  // Cancelled pending, escape, lost capture, no-op, outside/re-entry, unseen-target release, and remote metric change.
  await setupPanel(1024, 700);
  const pendingBefore = await settings();
  const pendingBox = await actionBox();
  const pendingGrid = await info();
  await evaluate('window.__delayNextWorkerPost=true');
  await mouse('mousePressed', pendingBox.x + pendingBox.width / 2, pendingBox.y + pendingBox.height / 2);
  await pointerMove('[aria-label="Move or select Action"]', pendingBox.x + pendingBox.width / 2 + pendingGrid.pitch * 5, pendingBox.y + pendingBox.height / 2);
  await delay(35);
  await mouse('mouseReleased', pendingBox.x + pendingBox.width / 2 + pendingGrid.pitch * 5, pendingBox.y + pendingBox.height / 2, 0);
  await delay(80);
  await resetItem('action-item', 5, 0);
  const pendingStats = await workerStats();
  assert.equal(pendingStats.active, 0);
  assert.equal(pendingStats.settingsWrites, 0, 'Pending release wrote settings');
  assert.equal(pendingStats.actions, 0);
  assert.equal(pendingStats.audioUpdates, 0);
  report.regressions.pendingRelease = { unchanged: pendingBefore.deck.items.find(item => item.id === 'action-item').x === 5, workers: pendingStats };

  const cancelCase = async kind => {
    await setupPanel(1024, 700);
    const b = await actionBox(), g = await info();
    const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await mouse('mousePressed', from.x, from.y);
    await pointerMove('[aria-label="Move or select Action"]', from.x + 12, from.y);
    await delay(40);
    if (kind === 'escape') await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    else if (kind === 'lost-capture') await evaluate(`(()=>{const h=document.querySelector('[aria-label="Move or select Action"]');h.dispatchEvent(new PointerEvent('lostpointercapture',{bubbles:true,pointerId:window.__pointer.id}))})()`);
    else if (kind === 'outside') await pointerMove('[aria-label="Move or select Action"]', g.x - 30, g.y - 30);
    else if (kind === 'unseen-release') await mouse('mouseReleased', from.x + g.pitch * 1.2, from.y, 0);
    else if (kind === 'noop') await pointerMove('[aria-label="Move or select Action"]', from.x + 12, from.y);
    if (!['unseen-release'].includes(kind)) await mouse('mouseReleased', from.x + 12, from.y, 0);
    await delay(220);
    const after = await settings();
    assert.equal(after.deck.items.find(item => item.id === 'action-item').x, 5, `${kind} changed the layout`);
    const stats = await workerStats();
    assert.equal(stats.settingsWrites, 0, `${kind} wrote settings`);
    assert.equal(stats.actions, 0, `${kind} dispatched an action`);
    assert.equal(stats.audioUpdates, 0, `${kind} wrote an audio value`);
    return stats;
  };
  const cancelled = {};
  for (const kind of ['escape', 'lost-capture', 'outside', 'unseen-release', 'noop']) cancelled[kind] = await cancelCase(kind);
  report.regressions.cancelPaths = cancelled;

  await setupPanel(1024, 700);
  const free1024 = await dragItem({ dx: 1, screenshotPrefix: 'canvas-free-1024' });
  assert.equal(free1024.settings.deck.items.find(item => item.id === 'action-item').x, 6);
  assert.equal(free1024.settingsWrites, 1);
  assert.ok(free1024.maxDrift <= 1, `1024px free move anchor drift ${free1024.maxDrift}px: ${JSON.stringify(free1024.drift)}`);
  await setupPanel(1024, 700);
  const occupied1024 = await dragItem({ dx: 5, screenshotPrefix: 'canvas-occupied-1024' });
  assert.equal(occupied1024.settings.deck.items.find(item => item.id === 'action-item').x, 10);
  assert.equal(occupied1024.settingsWrites, 1);
  assert.ok(occupied1024.stats.requests >= 1 && occupied1024.stats.replies >= 1);
  report.regressions.viewport1024 = { freeMoveAnchorErrorPx: free1024.maxDrift, freeMoveWrites: free1024.settingsWrites,
    occupiedMoveAnchorErrorPx: occupied1024.maxDrift, occupiedMoveWrites: occupied1024.settingsWrites,
    occupiedRequests: occupied1024.stats.requests, occupiedReplies: occupied1024.stats.replies };

  await setupPanel(1024, 700);
  const remoteBefore = await settings();
  const remote = structuredClone(remoteBefore);
  remote.deck.gap = 18;
  const remoteString = JSON.stringify(remote);
  const remoteBox = await actionBox(), remoteGrid = await info();
  const remoteFrom = { x: remoteBox.x + remoteBox.width / 2, y: remoteBox.y + remoteBox.height / 2 };
  await mouse('mousePressed', remoteFrom.x, remoteFrom.y);
  await pointerMove('[aria-label="Move or select Action"]', remoteFrom.x + 12, remoteFrom.y);
  await delay(50);
  await evaluate(`(()=>{const value=${JSON.stringify(remoteString)};localStorage.setItem('supadashboard:settings:v4',value);
    window.__canvasWriteBaseline=window.__canvasSettingsWrites.length;
    window.dispatchEvent(new StorageEvent('storage',{key:'supadashboard:settings:v4',newValue:value}))})()`);
  await delay(180);
  const remoteGap = (await info()).gap;
  await mouse('mouseReleased', remoteFrom.x + remoteGrid.pitch * 5, remoteFrom.y, 0);
  await delay(220);
  const remoteAfter = await settings(), remoteStats = await workerStats();
  assert.equal(remoteGap, 18, 'Remote metric change was not applied');
  assert.equal(remoteAfter.deck.items.find(item => item.id === 'action-item').x, 5, 'Remote metric change allowed the active drag to commit');
  assert.equal(remoteStats.settingsWrites, 0, 'Canceled drag wrote settings after a remote metric change');
  assert.equal(remoteStats.pendingPointerFrames, 0);
  assert.equal(remoteStats.actions, 0);
  assert.equal(remoteStats.audioUpdates, 0);
  assert.equal((await historyStatus()).canUndo, false);
  report.regressions.remoteMetricChange = { gap: remoteGap, actionX: 5, settingsWrites: remoteStats.settingsWrites,
    pendingPointerFrames: remoteStats.pendingPointerFrames, history: await historyStatus() };

  // Live resize clamps both the frame and snapped footprint at the slider, without fading its content.
  await setupPanel(1440, 900);
  const action = await actionBox();
  await mouse('mousePressed', action.x + action.width / 2, action.y + action.height / 2);
  await mouse('mouseReleased', action.x + action.width / 2, action.y + action.height / 2, 0);
  await waitFor('[data-corner="se"]');
  const resize = await evaluate(`(() => { const button=document.querySelector('[data-corner="se"]'); const mark=button.querySelector('span'); const tile=document.querySelector('[aria-label="Move or select Action"]');
    const b=button.getBoundingClientRect(),m=mark.getBoundingClientRect(),t=tile.getBoundingClientRect();return {hit:{x:b.x,y:b.y,w:b.width,h:b.height},mark:{x:m.x,y:m.y,w:m.width,h:m.height,opacity:getComputedStyle(mark).opacity},tile:{x:t.x,y:t.y,w:t.width,h:t.height}}})()`);
  assert.ok(resize.hit.w >= 28 && resize.hit.h >= 28, `Resize hit area was ${JSON.stringify(resize.hit)}`);
  assert.ok(Math.abs(resize.mark.x - (resize.tile.x + resize.tile.w + 3)) <= .5);
  assert.ok(Math.abs(resize.mark.y - (resize.tile.y + resize.tile.h + 3)) <= .5);
  assert.ok(Math.abs(Number(resize.mark.opacity) - .65) < .02);
  await mouse('mouseMoved', resize.hit.x + resize.hit.w / 2, resize.hit.y + resize.hit.h / 2, 0);
  await delay(130);
  const hoverAlpha = await evaluate(`getComputedStyle(document.querySelector('[data-corner="se"] span')).opacity`);
  assert.ok(Number(hoverAlpha) > .98, `Resize mark opacity on hover is ${hoverAlpha}`);
  await shot('canvas-handle-hover');
  const start = { x: resize.hit.x + resize.hit.w / 2, y: resize.hit.y + resize.hit.h / 2 };
  const size = await info();
  const sliderBefore = await rect('[aria-label="Move or select Vertical slider"]');
  const motionBefore = await evaluate(`getComputedStyle(document.querySelector('[aria-label="Move or select Action"]').parentElement).opacity`);
  const nodeBefore = await evaluate(`document.querySelector('[aria-label="Move or select Action"]').parentElement.firstElementChild`);
  await evaluate(`(()=>{window.__resizeAnimationFrames=[];const original=Element.prototype.animate;Element.prototype.animate=function(keyframes,options){window.__resizeAnimationFrames.push({tag:this.tagName,keys:keyframes.map(k=>Object.keys(k)),opacity:keyframes.some(k=>'opacity'in k),duration:options?.duration});return original.call(this,keyframes,options)}})()`);
  await mouse('mousePressed', start.x, start.y);
  let maxOverlap = 0, samples = 0, maxOpacityDelta = 0, maxAnchorError = 0;
  for (let i = 1; i <= 12; i++) {
    const point = { x: start.x + size.pitch * 4 * i / 12, y: start.y };
    await pointerMove('[data-corner="se"]', point.x, point.y);
    await delay(18);
    const ghost = await evaluate(`(() => { const frame=[...document.querySelector('[data-editing-chrome]').children].find(el=>el.tagName==='DIV'&&el.style.width==='0px');const line=frame?.querySelector('div');const r=line?.getBoundingClientRect();const slider=document.querySelector('[aria-label="Move or select Vertical slider"]').getBoundingClientRect();return {line:r&&{x:r.x,y:r.y,w:r.width,h:r.height},slider:{x:slider.x,y:slider.y,w:slider.width,h:slider.height},opacity:getComputedStyle(document.querySelector('[aria-label="Move or select Action"]').parentElement).opacity,translate:frame?.style.translate}})()`);
    if (ghost.line) {
      const overlapX = Math.max(0, Math.min(ghost.line.x + ghost.line.w, ghost.slider.x + ghost.slider.w) - Math.max(ghost.line.x, ghost.slider.x));
      const overlapY = Math.max(0, Math.min(ghost.line.y + ghost.line.h, ghost.slider.y + ghost.slider.h) - Math.max(ghost.line.y, ghost.slider.y));
      maxOverlap = Math.max(maxOverlap, overlapX * overlapY);
    }
    maxOpacityDelta = Math.max(maxOpacityDelta, Math.abs(Number(ghost.opacity) - Number(motionBefore)));
    samples++;
  }
  const accepted = await evaluate(`(() => ({area:document.querySelector('[aria-label="Move or select Action"]').parentElement.parentElement.style.gridArea,
    frames:window.__resizeAnimationFrames,opacity:getComputedStyle(document.querySelector('[aria-label="Move or select Action"]').parentElement).opacity}))()`);
  assert.ok(maxOverlap <= .25, `Continuous resize overlapped a neighbour by ${maxOverlap}px²`);
  assert.ok(maxOpacityDelta <= .01, `Content opacity changed by ${maxOpacityDelta}`);
  assert.equal(accepted.frames.some(frame => frame.opacity), false, 'Resize added an opacity animation to content');
  assert.ok(samples >= 10);
  await shot('canvas-resize-held');
  await mouse('mouseReleased', start.x + size.pitch * 4, start.y, 0);
  await delay(450);
  await shot('canvas-resize-committed');
  report.regressions.resize = { handle: resize, hoverAlpha, maxContinuousOverlapPx2: maxOverlap,
    maxContentOpacityDelta: maxOpacityDelta, acceptedFootprint: accepted.area, animationFrames: accepted.frames,
    samples, sliderBefore, nodeIdentityCaptured: !!nodeBefore };

  // Resize handles fade during pointer movement, remain hidden through layout settlement, then return.
  const moveHandle = '[aria-label="Move or select Action"]';
  const moveBox = await rect(moveHandle), moveGrid = await info();
  const moveFrom = { x: moveBox.x + moveBox.width / 2, y: moveBox.y + moveBox.height / 2 };
  await mouse('mousePressed', moveFrom.x, moveFrom.y);
  await pointerMove(moveHandle, moveFrom.x + moveGrid.pitch, moveFrom.y);
  await delay(140);
  const handlesHeld = await evaluate(`(() => { const chrome=document.querySelector('[data-editing-chrome]');const handle=chrome?.querySelector('[data-corner="se"]');return {opacity:Number(getComputedStyle(chrome).opacity),zIndex:getComputedStyle(chrome).zIndex,
    hidden:handle?.getAttribute('aria-hidden'),pointerEvents:handle&&getComputedStyle(handle).pointerEvents}; })()`);
  assert.ok(handlesHeld.opacity <= .01, `Resize handles remained visible during drag: ${JSON.stringify(handlesHeld)}`);
  assert.equal(handlesHeld.zIndex, '60');
  assert.equal(handlesHeld.hidden, 'true');
  assert.equal(handlesHeld.pointerEvents, 'none');
  await shot('canvas-handles-hidden-drag');
  await mouse('mouseReleased', moveFrom.x + moveGrid.pitch, moveFrom.y, 0);
  await delay(160);
  const handlesSettling = await evaluate(`Number(getComputedStyle(document.querySelector('[data-editing-chrome]')).opacity)`);
  assert.ok(handlesSettling <= .01, `Resize handles returned before layout settlement: ${handlesSettling}`);
  await delay(500);
  const handlesRestored = await evaluate(`Number(getComputedStyle(document.querySelector('[data-editing-chrome]')).opacity)`);
  assert.ok(handlesRestored >= .99, `Resize handles did not return after layout settlement: ${handlesRestored}`);
  await shot('canvas-handles-restored');
  report.regressions.handles = { duringDragOpacity: handlesHeld.opacity, duringSettleOpacity: handlesSettling,
    afterSettleOpacity: handlesRestored, editingChromeZIndex: handlesHeld.zIndex };

  // Removing a neighbouring tile leaves the selected editing chrome in the top stacking layer.
  await setupPanel(1440, 900);
  const oneMove = await rect('[aria-label="Move or select One"]');
  await mouse('mousePressed', oneMove.x + oneMove.width / 2, oneMove.y + oneMove.height / 2);
  await mouse('mouseReleased', oneMove.x + oneMove.width / 2, oneMove.y + oneMove.height / 2, 0);
  await waitFor('[data-editing-chrome] [data-corner="se"]');
  const chromeBeforeRemoval = await evaluate(`getComputedStyle(document.querySelector('[data-editing-chrome]')).zIndex`);
  await evaluate(`(() => { const key='supadashboard:settings:v4';const value=JSON.parse(localStorage.getItem(key));value.deck.items=value.deck.items.filter(item=>item.id!=='mixer-item');
    const raw=JSON.stringify(value);localStorage.setItem(key,raw);window.dispatchEvent(new StorageEvent('storage',{key,newValue:raw})); })()`);
  await delay(45);
  const chromeDuringRemoval = await evaluate(`(() => {const chrome=document.querySelector('[data-editing-chrome]');const handle=chrome?.querySelector('[data-corner="se"]');const r=handle?.getBoundingClientRect();const hit=r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {zIndex:getComputedStyle(chrome).zIndex,opacity:Number(getComputedStyle(chrome).opacity),handlePresent:!!handle,hit:hit===handle,items:JSON.parse(localStorage.getItem('supadashboard:settings:v4')).deck.items.length};})()`);
  assert.equal(chromeBeforeRemoval, '60');
  assert.equal(chromeDuringRemoval.zIndex, '60');
  assert.equal(chromeDuringRemoval.handlePresent, true);
  assert.equal(chromeDuringRemoval.hit, true, 'A neighbouring tile covered the editing handle during removal');
  assert.equal(chromeDuringRemoval.items, 7);
  await shot('canvas-adjacent-removal-chrome');
  report.regressions.adjacentRemovalChrome = { zIndexBefore: chromeBeforeRemoval, ...chromeDuringRemoval };

  // Inspect actual marked DOM hits in the dashboard and the translated marker box during FLIP.
  await viewport(1440, 900);
  await send('Page.navigate', { url: origin });
  await waitFor('[data-dashboard-tile]');
  await delay(250);
  const census = await evaluate(`(() => {
    const roots=[...document.querySelectorAll('[style*="grid-area"]')].filter(root=>root.querySelector(':scope > [data-dashboard-tile]'));
    let hitCount=0,missingMarkers=0,dragRegionFailures=0,translatedMarkerFailures=0,staleGridMarkers=0,maxVisualUnmarkedAreaPx2=0;
    const hits=[];
    for(const root of roots){
      if(root.hasAttribute('data-dashboard-tile'))staleGridMarkers++;
      const r=root.getBoundingClientRect();
      const points=[[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]];
      const icon=root.querySelector('svg');if(icon){const b=icon.getBoundingClientRect();points.push([(b.x+b.width/2-r.x)/r.width,(b.y+b.height/2-r.y)/r.height])}
      for(const [fx,fy] of points){const x=r.x+r.width*fx,y=r.y+r.height*fy;const hit=document.elementFromPoint(x,y);if(!hit)continue;hitCount++;
        const interactive=hit.closest('button,[role="slider"]');
        if(interactive?!interactive.closest('[data-dashboard-tile]'):!hit.closest('[data-dashboard-tile]'))missingMarkers++;
        if(getComputedStyle(hit).getPropertyValue('-webkit-app-region')!=='no-drag')dragRegionFailures++;
        hits.push({x,y,tag:hit.tagName,marked:hit.hasAttribute('data-dashboard-tile'),interactive:interactive?.tagName||null});
      }
      const moving=root.querySelector(':scope > [data-dashboard-tile]');
      if(moving){const m=moving.getBoundingClientRect();if(!moving.hasAttribute('data-dashboard-tile')||getComputedStyle(moving).getPropertyValue('-webkit-app-region')!=='no-drag'||m.width<r.width-.5||m.height<r.height-.5)translatedMarkerFailures++;
        for(const visual of moving.querySelectorAll('[data-dashboard-tile]')){const v=visual.getBoundingClientRect();if(!v.width||!v.height)continue;
          const iw=Math.max(0,Math.min(v.x+v.width,m.x+m.width)-Math.max(v.x,m.x)),ih=Math.max(0,Math.min(v.y+v.height,m.y+m.height)-Math.max(v.y,m.y));
          maxVisualUnmarkedAreaPx2=Math.max(maxVisualUnmarkedAreaPx2,v.width*v.height-iw*ih);
          if(v.x<m.x-.5||v.y<m.y-.5||v.x+v.width>m.x+m.width+.5||v.y+v.height>m.y+m.height+.5)translatedMarkerFailures++;
        }
      }
    }
    return {hitCount,missingMarkers,dragRegionFailures,translatedMarkerFailures,staleGridMarkers,maxVisualUnmarkedAreaPx2,hits};
  })()`);
  assert.ok(census.hitCount > 20);
  assert.equal(census.missingMarkers, 0);
  assert.equal(census.dragRegionFailures, 0);
  assert.equal(census.translatedMarkerFailures, 0);
  assert.equal(census.staleGridMarkers, 0);
  assert.ok(census.maxVisualUnmarkedAreaPx2 <= .25);
  await shot('canvas-dashboard-hit-census');
  report.tileHitCensus = census;

  const toastTexts = () => evaluate(`([...document.querySelectorAll('[data-sonner-toast]')].map(node=>node.innerText))`);
  const testUnboundButtonPull = async selector => {
    const box = await rect(selector);
    assert.ok(box, `Missing button for unbound pull check: ${selector}`);
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const before = await evaluate(`(() => {const button=document.querySelector(${JSON.stringify(selector)});const icon=button.querySelector('svg');const r=icon.getBoundingClientRect();return {x:r.x,y:r.y,label:button.getAttribute('aria-label')};})()`);
    const notifications = await toastTexts();
    await mouse('mousePressed', from.x, from.y);
    await delay(30);
    await pointerMove(selector, from.x + 60, from.y);
    const live = await evaluate(`(() => {const button=document.querySelector(${JSON.stringify(selector)});const surface=button.firstElementChild.firstElementChild;const layer=button.querySelector('.widget-content > div');const matrix=new DOMMatrixReadOnly(getComputedStyle(layer).transform==='none'?undefined:getComputedStyle(layer).transform);const icon=button.querySelector('svg').getBoundingClientRect();
      return {translate:{x:matrix.m41,y:matrix.m42},surfaceTransform:surface.style.transform,icon:{x:icon.x,y:icon.y},runningScale:[...surface.getAnimations()].filter(a=>a.playState==='running'&&a.effect?.getKeyframes().some(frame=>String(frame.transform??'').includes('scale'))).length};})()`);
    await mouse('mouseReleased', from.x + 60, from.y, 0);
    await delay(180);
    assert.ok(Math.abs(live.translate.x) < .1 && Math.abs(live.translate.y) < .1, `Unbound button pull translated its content: ${JSON.stringify(live)}`);
    assert.equal(live.surfaceTransform, 'none', `Press scale remained after drag slop: ${live.surfaceTransform}`);
    assert.equal(live.runningScale, 0);
    assert.ok(Math.hypot(live.icon.x - before.x, live.icon.y - before.y) < .5, `Unbound pull shifted the button icon: ${JSON.stringify({ before, live })}`);
    assert.deepEqual(await toastTexts(), notifications, `Unbound pull showed a runtime error toast: ${JSON.stringify(await toastTexts())}`);
    return { label: before.label, translate: live.translate, surfaceTransform: live.surfaceTransform,
      iconDisplacementPx: Math.hypot(live.icon.x - before.x, live.icon.y - before.y), toasts: notifications.length };
  };
  const noGestureButton = await testUnboundButtonPull('button[aria-label="A"]');
  const unboundButtonDirection = await testUnboundButtonPull('button[aria-label="One A"]');

  await evaluate(`(async()=>{const volume=await import('/src/core/volume.ts');window.__volumeDispose?.();window.__volumeInitActive=true;try{await volume.initVolumeSync()}finally{window.__volumeInitActive=false}})()`);
  const sliders = await evaluate(`(() => [...document.querySelectorAll('[role="slider"]')].map(el=>({label:el.getAttribute('aria-label'),value:el.getAttribute('aria-valuenow'),orientation:el.getAttribute('aria-orientation'),marked:el.hasAttribute('data-dashboard-tile')})))()`);
  assert.ok(sliders.some(slider => slider.value === '65'));
  const valueTrack = await rect('[role="slider"][aria-orientation="vertical"]');
  await mouse('mousePressed', valueTrack.x + valueTrack.width / 2, valueTrack.y + valueTrack.height * .3);
  await pointerMove('[role="slider"][aria-orientation="vertical"]', valueTrack.x + valueTrack.width / 2, valueTrack.y + valueTrack.height * .6);
  await mouse('mouseReleased', valueTrack.x + valueTrack.width / 2, valueTrack.y + valueTrack.height * .6, 0);
  await delay(150);
  const audioResult = await evaluate(`({updates:window.__audioUpdates.slice(),value:document.querySelector('[role="slider"][aria-orientation="vertical"]').getAttribute('aria-valuenow')})`);
  assert.ok(audioResult.updates.length >= 1, 'Slider did not call the mocked audio_update adapter');
  assert.ok(Number(audioResult.value) !== 65, 'Slider pointer input did not change aria-valuenow');
  report.sliderValue = audioResult;

  const sliderSelector = '[role="slider"][aria-orientation="vertical"]';
  const sliderBox = await rect(sliderSelector), sliderFrom = { x: sliderBox.x + sliderBox.width / 2, y: sliderBox.y + sliderBox.height / 2 };
  const sliderValueBeforePull = await evaluate(`document.querySelector(${JSON.stringify(sliderSelector)}).getAttribute('aria-valuenow')`);
  const pullButton = 'button[aria-label="Swap A"]', pullButtonBox = await rect(pullButton);
  const pullStart = { x: pullButtonBox.x + pullButtonBox.width / 2, y: pullButtonBox.y + pullButtonBox.height / 2 };
  const notificationsBefore = await toastTexts();
  await mouse('mousePressed', pullStart.x, pullStart.y);
  await pointerMove(pullButton, pullStart.x, pullStart.y + 12);
  const pullFollowing = await evaluate(`(() => {const layer=document.querySelector(${JSON.stringify(pullButton)}).querySelector('.widget-content > div');const style=getComputedStyle(layer);const matrix=new DOMMatrixReadOnly(style.transform==='none'?undefined:style.transform);
    return {x:matrix.m41,y:matrix.m42,transition:style.transitionProperty,transformAnimations:[...layer.getAnimations()].filter(a=>a.effect?.getKeyframes().some(frame=>frame.transform)).length};})()`);
  assert.ok(Math.abs(pullFollowing.x) < .5 && Math.abs(pullFollowing.y - 12) < 1, `Pull content lagged the pointer: ${JSON.stringify(pullFollowing)}`);
  assert.equal(pullFollowing.transformAnimations, 0, 'A transition is animating the live pull transform');
  const pullSize = await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(pullButton)}).getBoundingClientRect();return {width:r.width,height:r.height};})()`);
  const armDistance = Math.min(48, Math.max(20, pullSize.height * .25));
  await pointerMove(pullButton, pullStart.x, pullStart.y + armDistance + 1);
  const armedPull = await evaluate(`(() => {const layer=document.querySelector(${JSON.stringify(pullButton)}).querySelector('.widget-content > div');const m=new DOMMatrixReadOnly(getComputedStyle(layer).transform);return {x:m.m41,y:m.m42};})()`);
  await shot('canvas-configured-pull-held');
  await mouse('mouseReleased', pullStart.x, pullStart.y + armDistance + 1, 0);
  await delay(500);
  const buttonAfterPull = await evaluate(`document.querySelector(${JSON.stringify(pullButton.replace('Swap A','Swap B'))})?.getAttribute('aria-label')`);
  const notificationsAfter = await toastTexts();
  assert.equal(buttonAfterPull, 'Swap B', 'The configured button pull did not run its captured state action');
  assert.deepEqual(notificationsAfter, notificationsBefore, `Configured pull emitted an unexpected failure toast: ${JSON.stringify(notificationsAfter)}`);
  await shot('canvas-configured-pull-settled');

  const sliderPullStart = { x: sliderFrom.x, y: sliderFrom.y }, sliderNotifications = await toastTexts();
  const audioCountBeforePulls = (await evaluate('window.__audioUpdates.length'));
  await mouse('mousePressed', sliderPullStart.x, sliderPullStart.y);
  await pointerMove(sliderSelector, sliderPullStart.x + 12, sliderPullStart.y);
  const sliderFollowing = await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(sliderSelector)});const layer=el.closest('.widget-content').firstElementChild;const m=new DOMMatrixReadOnly(getComputedStyle(layer).transform);return {x:m.m41,y:m.m42};})()`);
  assert.ok(Math.abs(sliderFollowing.x - 12) < 1 && Math.abs(sliderFollowing.y) < .5, `Configured slider pull did not follow the pointer: ${JSON.stringify(sliderFollowing)}`);
  const sliderPullSize = await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(sliderSelector)}).getBoundingClientRect();return {width:r.width,height:r.height};})()`);
  const sliderArmDistance = Math.min(48, Math.max(20, sliderPullSize.width * .25));
  await pointerMove(sliderSelector, sliderPullStart.x + sliderArmDistance + 1, sliderPullStart.y);
  await mouse('mouseReleased', sliderPullStart.x + sliderArmDistance + 1, sliderPullStart.y, 0);
  await delay(450);
  const sliderAfterConfiguredPull = await evaluate(`document.querySelector(${JSON.stringify(sliderSelector)}).getAttribute('aria-label')`);
  assert.equal(sliderAfterConfiguredPull, 'Spotify', 'The configured slider pull did not run its captured state action');
  assert.equal(await evaluate('window.__audioUpdates.length'), audioCountBeforePulls, 'A cross-axis slider pull wrote an audio value');
  assert.deepEqual(await toastTexts(), sliderNotifications, 'Configured slider pull emitted a failure toast');

  await evaluate(`(async()=>{const {settings}=await import('/src/core/settings.svelte.ts');settings.controls.find(control=>control.id==='slider').scenario=undefined})()`);
  await delay(80);
  const unboundSliderValue = await evaluate(`document.querySelector(${JSON.stringify(sliderSelector)}).getAttribute('aria-valuenow')`);
  await mouse('mousePressed', sliderPullStart.x, sliderPullStart.y);
  await pointerMove(sliderSelector, sliderPullStart.x + 60, sliderPullStart.y);
  const unboundSlider = await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(sliderSelector)});const layer=el.closest('.widget-content').firstElementChild;const m=new DOMMatrixReadOnly(getComputedStyle(layer).transform);return {x:m.m41,y:m.m42,value:el.getAttribute('aria-valuenow')};})()`);
  await mouse('mouseReleased', sliderPullStart.x + 60, sliderPullStart.y, 0);
  await delay(140);
  assert.ok(Math.abs(unboundSlider.x) < .1 && Math.abs(unboundSlider.y) < .1, `Unbound slider pull translated content: ${JSON.stringify(unboundSlider)}`);
  assert.equal(unboundSlider.value, unboundSliderValue, 'Unbound slider pull changed the volume value');
  assert.equal(await evaluate('window.__audioUpdates.length'), audioCountBeforePulls, 'Unbound slider pull wrote an audio value');
  assert.deepEqual(await toastTexts(), sliderNotifications, 'Unbound slider pull emitted an error toast');
  report.pullGestures = { noGestureButton, unboundButtonDirection, configuredButton: { armThresholdPx: armDistance,
    firstFrameTranslation: pullFollowing, armedTranslation: armedPull, finalLabel: buttonAfterPull },
    configuredSlider: { armThresholdPx: sliderArmDistance, firstFrameTranslation: sliderFollowing, finalLabel: sliderAfterConfiguredPull },
    unboundSlider, audioWritesDuringPulls: (await evaluate('window.__audioUpdates.length')) - audioCountBeforePulls,
    toastCount: notificationsAfter.length };

  report.errors = errors;
  assert.equal(errors.length, 0, `Uncaught browser exceptions: ${errors.join('\n')}`);
  assert.equal(errors.some(message => message.includes('DataCloneError')), false);
  report.finalWorkers = await workerStats();
  report.command = `node src/controls/deck-grid.browser-check.mjs --url ${values.url} --cdp-port ${cdpPort} --artifacts ${artifactDir}`;
  const output = path.join(artifactDir, 'deck-grid-browser-report.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${output}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
}

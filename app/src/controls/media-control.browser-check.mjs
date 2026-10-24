import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const origin = process.env.MEDIA_CHECK_URL ?? 'http://127.0.0.1:5184';
const cdpPort = Number(process.env.MEDIA_CHECK_CDP_PORT ?? 9416);
assert.ok(Number.isInteger(cdpPort) && cdpPort > 0 && ![9223, 9224].includes(cdpPort), 'Use an owned CDP port');
const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
assert.ok(fs.existsSync(chromePath), `Chrome not found: ${chromePath}`);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'supa-media-chrome-'));
const videoPath = path.join(profile, 'fixture.webm');
const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'color=c=red:s=128x72:d=1:r=10', '-an', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8',
  '-y', videoPath], { encoding: 'utf8' });
assert.equal(generated.status, 0, generated.stderr || 'Could not generate browser video fixture');
const video = fs.readFileSync(videoPath).toString('base64');
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

let socket;
let messageId = 0;
const pending = new Map();
const browserErrors = [];
let resolveLoad;
let loadPromise = Promise.resolve();
try {
  let pages;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      if (pages.some(page => page.type === 'page')) break;
    } catch {}
    await delay(100);
  }
  const page = pages?.find(entry => entry.type === 'page');
  assert.ok(page, 'Isolated Chrome did not start');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Page.loadEventFired') resolveLoad?.();
    if (message.method === 'Runtime.exceptionThrown')
      browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (!message.id || !pending.has(message.id)) return;
    const task = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(new Error(`${task.method}: ${message.error.message}`)); else task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++messageId;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10000);
    pending.set(id, { method, resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    if (result.result?.subtype === 'error') throw new Error(result.result.description);
    return result.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');

  const checkRole = async role => {
    const url = `${origin}/src/controls/MediaControlHarness.html?role=${role}&video=${encodeURIComponent(video)}`;
    loadPromise = new Promise(resolve => { resolveLoad = resolve; });
    await send('Page.navigate', { url });
    await loadPromise;
    const result = await evaluate(`new Promise(resolve => {
      const started = performance.now();
      const read = () => {
        const video = document.querySelector('[data-content-tile] video');
        const state = { role: document.documentElement.dataset.windowRole, isTauri: globalThis.isTauri,
          src: video?.getAttribute('src')?.slice(0, 48) ?? null, videoWidth: video?.videoWidth ?? 0,
          readyState: video?.readyState ?? 0, unavailable: document.body.innerText.includes('Unavailable'),
          conversions: window.__mediaConversions ?? [] };
        if (state.videoWidth > 0 || performance.now() - started > 8000) resolve(state);
        else setTimeout(read, 50);
      };
      read();
    })`);
    assert.equal(result.role, role, `${role} harness did not mount; browser errors: ${browserErrors.join(' | ')}`);
    assert.equal(result.videoWidth, 128, `${role} did not load the converted video: ${JSON.stringify(result)}`);
    assert.equal(result.unavailable, false, `${role} still shows Unavailable`);
    assert.ok(result.src?.startsWith('data:video/webm;base64,'), `${role} has no media src`);
    assert.deepEqual(result.conversions, ['C:/Users/me\\Pictures\\pics\\fixture.webm']);
    return result;
  };

  const dashboard = await checkRole('main');
  const panel = await checkRole('panel');
  assert.equal(dashboard.isTauri, false, 'Dashboard mock must exercise the missing marker');
  assert.equal(panel.isTauri, true, 'Panel mock must exercise the normal Tauri marker');
  process.stdout.write(`${JSON.stringify({ browser: 'isolated headless Chrome', cdpPort, dashboard, panel }, null, 2)}\n`);
} finally {
  socket?.close();
  chrome.kill();
}

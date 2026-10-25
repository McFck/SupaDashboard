import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cdp = process.env.SUBWAY_CDP_URL ?? 'http://127.0.0.1:9347';
const base = process.env.SUBWAY_VITE_URL ?? 'http://127.0.0.1:5187';
const outputRoot = process.argv[2] ?? process.env.BB_THREAD_STORAGE;
if (!outputRoot) throw new Error('Pass the Subway thread-storage directory as the first argument');
const output = path.join(outputRoot, process.argv[3] ?? 'subway-fix');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

await mkdir(output, { recursive: true });
const targets = await (await fetch(`${cdp}/json/list`)).json();
const target = targets.find(page => page.type === 'page');
assert(target, `No isolated Chrome page at ${cdp}`);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

let sequence = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('close', () => {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error('CDP connection closed while a request was pending'));
  }
  pending.clear();
});
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
    errors.push(message.params.args.map(argument => argument.value ?? argument.description ?? '').join(' '));
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
};

function call(method, params = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, timeoutMs = 10_000) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, message, timeout = 20_000, matches = Boolean) {
  const started = Date.now();
  let lastValue;
  let lastCdpTimeout;
  while (Date.now() - started < timeout) {
    const remaining = timeout - (Date.now() - started);
    try {
      lastValue = await evaluate(expression, Math.min(2_000, remaining));
      if (matches(lastValue)) return lastValue;
    } catch (error) {
      if (!String(error?.message ?? error).includes('CDP Runtime.evaluate request timed out')) throw error;
      lastCdpTimeout = String(error.message);
    }
    await pause(Math.min(100, Math.max(0, timeout - (Date.now() - started))));
  }
  throw new Error(`${message}; last result: ${JSON.stringify(lastValue)}${lastCdpTimeout ? `; last CDP timeout: ${lastCdpTimeout}` : ''}; browser errors: ${errors.join(' | ')}`);
}

const visibleDialog = `(() => [...document.querySelectorAll('[role="dialog"][aria-labelledby="skin-quick-actions-title"]')]
  .find(dialog => { const rect = dialog.getBoundingClientRect(); const style = getComputedStyle(dialog);
    const overlay = dialog.closest('[data-skin-input="ui"]');
    const frame = dialog.closest('[data-visible-page]');
    if (frame && frame.getAttribute('data-visible-page') !== 'true') return false;
    return overlay?.getAttribute('aria-hidden') === 'false' && !overlay.inert &&
      dialog.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none' &&
      rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight; }))()`;

async function viewport(width, height) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await pause(150);
}

async function screenshot(name) {
  const capture = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const file = path.join(output, name);
  await writeFile(file, Buffer.from(capture.data, 'base64'));
  return file;
}

const pixelSample = `(() => {
  const canvas = [...document.querySelectorAll('canvas[data-skin-input="scene"]')].find(item => {
    const frame = item.closest('[data-visible-page]');
    return !frame || frame.getAttribute('data-visible-page') === 'true';
  });
  if (!canvas) return null;
  const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let hash = 2166136261, nonBackground = 0, opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a > 0) {
      opaque++;
      if (Math.abs(r - 16) + Math.abs(g - 23) + Math.abs(b - 27) > 18) nonBackground++;
    }
    hash = Math.imul(hash ^ r, 16777619);
    hash = Math.imul(hash ^ g, 16777619);
    hash = Math.imul(hash ^ b, 16777619);
    hash = Math.imul(hash ^ a, 16777619);
  }
  return { width, height, opaque, nonBackground, hash: (hash >>> 0).toString(16) };
})()`;

async function tap(x, y) {
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function tapButton(label, selector = 'button') {
  const point = await evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => {
      if (item.textContent.trim() !== ${JSON.stringify(label)} || item.closest('[aria-hidden="true"], [inert]')) return false;
      const frame = item.closest('[data-visible-page]');
      if (frame && frame.getAttribute('data-visible-page') !== 'true') return false;
      const rect = item.getBoundingClientRect();
      if (!(rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight)) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === item || item.contains(hit);
    });
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
  assert(point, `Button not found: ${label}`);
  await tap(point.x, point.y);
  return point;
}

async function tapAria(label, selector = '[aria-label]') {
  const point = await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => {
      if (item.getAttribute('aria-label') !== ${JSON.stringify(label)}) return false;
      if (item.closest('[aria-hidden="true"], [inert]')) return false;
      const frame = item.closest('[data-visible-page]');
      if (frame && frame.getAttribute('data-visible-page') !== 'true') return false;
      const rect = item.getBoundingClientRect();
      if (!(item.getClientRects().length > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight)) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === item || item.contains(hit);
    });
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
  assert(point, `Element not found: ${label}`);
  await tap(point.x, point.y);
  return point;
}

async function tapButtonContaining(label, selector = 'button') {
  const point = await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => {
      if (!item.textContent.includes(${JSON.stringify(label)}) || item.closest('[aria-hidden="true"], [inert]')) return false;
      const frame = item.closest('[data-visible-page]');
      if (frame && frame.getAttribute('data-visible-page') !== 'true') return false;
      const rect = item.getBoundingClientRect();
      if (!(rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight)) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === item || item.contains(hit);
    });
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert(point, `Button containing text not found: ${label}`);
  await tap(point.x, point.y);
}

async function tapOption(label) {
  const matchingVisibleOption = `(() => [...document.querySelectorAll('[role="option"]')].find(item => {
    if (!item.textContent.trim().includes(${JSON.stringify(label)})) return false;
    if (item.closest('[aria-hidden="true"], [inert]')) return false;
    const rect = item.getBoundingClientRect();
    if (!(item.getClientRects().length > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight)) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === item || item.contains(hit) || hit?.closest('[role="option"]') === item;
  }))()`;
  await waitFor(`Boolean(${matchingVisibleOption})`,
    `Visible option did not appear: ${label}`);
  const point = await evaluate(`(() => {
    const option = ${matchingVisibleOption};
    if (!option) return null;
    const rect = option.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, text: option.textContent.trim(), hit: hit?.textContent?.trim() ?? hit?.tagName };
  })()`);
  assert(point, `Option not found: ${label}`);
  await tap(point.x, point.y);
}

async function chooseQuickActionLine(label, direction) {
  const expanded = await evaluate(`${visibleDialog}?.querySelector('[aria-label="Parameters for Change Subway line"]')?.getAttribute('aria-expanded')`);
  if (expanded !== 'true') await tapAria('Parameters for Change Subway line');
  await waitFor(`${visibleDialog}?.querySelector('[role="combobox"]')`, 'Quick-action line field did not open');
  for (const [index, value] of [[0, label], [1, direction], [2, 'Default start']]) {
    const trigger = await evaluate(`(() => {
      const item = ${visibleDialog}?.querySelectorAll('[role="combobox"]')[${index}];
      if (!item) return null;
      item.scrollIntoView({ block: 'center' });
      const r = item.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hit: hit === item || item.contains(hit), target: hit?.outerHTML?.slice(0, 240) };
    })()`);
    assert(trigger, `Quick-action field ${index + 1} is missing`);
    assert(trigger.hit, `Quick-action field ${index + 1} is blocked by ${trigger.target}`);
    await tap(trigger.x, trigger.y);
    await waitFor(`([...document.querySelectorAll('[role="option"]')].some(item => { const r = item.getBoundingClientRect(); const hit = document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return !item.closest('[aria-hidden="true"], [inert]') && item.getClientRects().length > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && (hit===item || item.contains(hit) || hit?.closest('[role="option"]')===item); }))`,
      `Quick-action field ${index + 1} options did not open`);
    await tapOption(value);
    await waitFor(`${visibleDialog}?.querySelectorAll('[role="combobox"]')[${index}]?.textContent.includes(${JSON.stringify(value)})`,
      `Quick-action field ${index + 1} did not select ${value}`);
    // Bits UI removes the previous popup after its close transition; wait before clicking the next field.
    await pause(250);
  }
  const runPoint = await evaluate(`(() => {
    const button = ${visibleDialog}?.querySelector('[aria-label="Run Change Subway line"]');
    if (!button) return null;
    button.scrollIntoView({ block: 'center' }); const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === button || button.contains(hit), target: hit?.tagName };
  })()`);
  assert(runPoint, 'Visible Change Subway line action is missing');
  assert(runPoint.hit, `Change Subway line action is blocked by ${runPoint.target}`);
  await tap(runPoint.x, runPoint.y);
}

async function openQuickActions() {
  const sceneRect = await evaluate(`(() => {
    const canvas = [...document.querySelectorAll('canvas[data-skin-input="scene"]')].find(item => {
      const frame = item.closest('[data-visible-page]');
      return !frame || frame.getAttribute('data-visible-page') === 'true';
    });
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  assert(sceneRect, 'Visible Subway canvas is missing for the triple tap');
  for (let index = 0; index < 3; index++) { await tap(sceneRect.x, sceneRect.y); await pause(150); }
  await waitFor(`${visibleDialog} !== undefined`,
    'Triple tap did not open Subway quick actions');
}

await call('Runtime.enable');
await call('Page.enable');
await call('Network.enable');
await viewport(780, 424);
await call('Page.navigate', { url: `${base}/src/plugins/subway/subway-dashboard.browser.html?view=main` });
await waitFor(`window.__subwayDashboardCheck?.runtimeOwner() === true && document.querySelector('canvas[data-skin-input="scene"]')`,
  'Dashboard did not become the runtime owner');
await waitFor(`window.__subwayDashboardCheck.assetLoadResult() !== 'pending'`, 'Subway asset load did not settle');
await waitFor(`window.__subwayDashboardCheck.cuePlanResult() !== 'pending'`, 'Subway cue plan check did not settle');
const runtimeDiagnostic = await evaluate('window.__subwayDashboardCheck.snapshot()');
const [assetLoadResult, cuePlanResult] = await Promise.all([
  evaluate('window.__subwayDashboardCheck.assetLoadResult()'), evaluate('window.__subwayDashboardCheck.cuePlanResult()'),
]);
console.log('dashboard runtime diagnostic', JSON.stringify({ owner: runtimeDiagnostic.owner, line: runtimeDiagnostic.line,
  state: runtimeDiagnostic.scene?.snapshot, assetLoadResult, cuePlanResult }));
await waitFor(`(${pixelSample})?.nonBackground > 50`, 'Dashboard Subway canvas remained blank');
const initial = await evaluate('window.__subwayDashboardCheck.snapshot()');
const { scene: _scene, ...initialState } = initial;
assert.deepEqual(initialState, { configuredSkin: 'subway', configuredPage: 'subway-page-1', owner: true,
  activePage: 'subway-page-1', state: 'stopped', station: 'JY01', line: 'yamanote' });
assert.equal(initial.scene?.snapshot.paused, false, 'Default Subway run did not start on the eligible dashboard surface');
assert.equal(await evaluate(`document.documentElement.classList.contains('transparent')`), true, 'Dashboard role must be transparent');
const at780 = await evaluate(pixelSample);
const dashboard780 = await screenshot('dashboard-780x424.png');

await pause(6_300);
const afterTime = await evaluate(pixelSample);
assert(afterTime.nonBackground > 50, 'Subway LCD content disappeared after time advanced');
assert.notEqual(afterTime.hash, at780.hash, 'Subway LCD pixels did not change after time advanced');

const viewSelector = '[data-visible-page="true"] nav[aria-label="Skin view"] button';
const displayControls = await evaluate(`(() => [...document.querySelectorAll(${JSON.stringify(viewSelector)})].map(button => {
  const rect = button.getBoundingClientRect();
  return { label: button.textContent.trim(), left: rect.left, right: rect.right, width: rect.width, height: rect.height };
}))()`);
assert(displayControls.every(button => button.width >= 35 && button.height >= 22), `Subway view controls are too small: ${JSON.stringify(displayControls)}`);
const navBounds = await evaluate(`(() => [...document.querySelectorAll('[data-visible-page="true"] nav[aria-label="Skin view"] button, [data-visible-page="true"] nav[aria-label="Dashboard pages"] button')].map(button => {
  const rect = button.getBoundingClientRect();
  return { label: button.getAttribute('aria-label') || button.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
}))()`);
for (let i = 0; i < navBounds.length; i++) for (let j = i + 1; j < navBounds.length; j++) {
  const a = navBounds[i], b = navBounds[j];
  assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
    `Subway navigation hit regions overlap: ${JSON.stringify([a, b])}`);
}
const stripButton = await evaluate(`(() => {
  return [...document.querySelectorAll('[data-visible-page="true"] [data-skin-slot="strip"] button[data-dashboard-tile]')].map(button => {
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
      bounds: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
  });
})()`);
assert.equal(stripButton.length, 8, `Expected all 8 Subway strip controls: ${JSON.stringify(stripButton)}`);
for (let index = 0; index < stripButton.length; index++) {
  const button = stripButton[index];
  assert(button.bounds.right <= displayControls[0].left || button.bounds.left >= displayControls.at(-1).right ||
    button.bounds.bottom <= (await evaluate(`document.querySelector('[data-visible-page="true"] nav[aria-label="Skin view"]').getBoundingClientRect().top`)),
    `Subway strip control overlaps the view navigation: ${JSON.stringify(button.bounds)}`);
  await tap(button.x, button.y);
  await waitFor(`window.__subwayDashboardCheck.slotActionCalls() === ${index + 1}`,
    `Subway strip control ${index + 1} did not run its action`);
}

await tapButton('Map', viewSelector);
await waitFor(`document.querySelector('[data-visible-page="true"] nav[aria-label="Skin view"] button[aria-pressed="true"]')?.textContent.trim() === 'Map'`, 'Map view did not activate');
await tapButton('Run', viewSelector);
await waitFor(`document.querySelector('[data-visible-page="true"] nav[aria-label="Skin view"] button[aria-pressed="true"]')?.textContent.trim() === 'Run'`, 'Run view did not activate');
const slotCounts = await evaluate(`({
  strip: document.querySelectorAll('[data-visible-page="true"] [data-skin-slot="strip"] button[data-dashboard-tile]').length,
  side: document.querySelectorAll('[data-visible-page="true"] [data-skin-slot="side"] button[data-dashboard-tile]').length,
})`);
assert(slotCounts.strip > 0 && slotCounts.side > 0, `Subway control slots are empty: ${JSON.stringify(slotCounts)}`);

const changedState = await waitFor('window.__subwayDashboardCheck.snapshot()',
  'Subway run did not arrive at its next station', 120_000,
  state => state?.owner === true && state?.line === 'yamanote' && state?.station === 'JY02' &&
    state?.scene?.snapshot.station === 'JY02' && state?.scene?.snapshot.paused === false);
assert(changedState && changedState.owner && changedState.line === 'yamanote' && changedState.station === 'JY02' &&
  changedState.scene?.snapshot.station === 'JY02' && changedState.scene?.snapshot.paused === false,
  `Subway arrival state was unexpected: ${JSON.stringify(changedState)}`);

await openQuickActions();
const quickActionsMetrics = await evaluate(`(() => {
  const dialog = ${visibleDialog};
  const title = dialog?.querySelector('h2');
  const button = dialog?.querySelector('button[aria-label^="Run "]');
  const rect = dialog?.getBoundingClientRect();
  return { rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    fontSize: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
    buttonHeight: button?.getBoundingClientRect().height ?? 0,
    bottomActions: [...(dialog?.querySelectorAll('button') ?? [])].map(item => item.getAttribute('aria-label') || item.textContent.trim()) };
})()`);
assert(quickActionsMetrics.rect && quickActionsMetrics.rect.width >= 280 && quickActionsMetrics.rect.height >= 240 &&
  quickActionsMetrics.rect.x >= 0 && quickActionsMetrics.rect.y >= 0 &&
  quickActionsMetrics.rect.x + quickActionsMetrics.rect.width <= 780 && quickActionsMetrics.rect.y + quickActionsMetrics.rect.height <= 424,
  `Quick-action dialog is not viewport-sized/readable: ${JSON.stringify(quickActionsMetrics)}`);
assert(quickActionsMetrics.fontSize >= 12 && quickActionsMetrics.buttonHeight >= 30,
  `Quick-action text or targets are too small: ${JSON.stringify(quickActionsMetrics)}`);
const quickActionsScreenshot = await screenshot('quick-actions-780.png');
await tapAria('Parameters for Change Subway line');
const expandedQuickActions = await evaluate(`(() => {
  const dialog = ${visibleDialog};
  const rect = dialog.getBoundingClientRect();
  return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    clientHeight: dialog.clientHeight, scrollHeight: dialog.scrollHeight,
    selectors: [...dialog.querySelectorAll('[role="combobox"]')].map(item => {
      const r = item.getBoundingClientRect(); return { y: r.y, bottom: r.bottom, height: r.height, fontSize: parseFloat(getComputedStyle(item).fontSize) };
    }) };
})()`);
assert(expandedQuickActions.rect.y >= 0 && expandedQuickActions.rect.y + expandedQuickActions.rect.height <= 424 &&
  expandedQuickActions.clientHeight <= 392 && expandedQuickActions.selectors.length === 3 &&
  expandedQuickActions.selectors.every(item => item.height >= 30 && item.fontSize >= 12),
  `Expanded quick-action fields are clipped or unreadable: ${JSON.stringify(expandedQuickActions)}`);
await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 390, y: 212, deltaY: 1_000, deltaX: 0 });
await pause(150);
const bottomQuickAction = await evaluate(`(() => {
  const dialog = ${visibleDialog};
  const button = [...dialog.querySelectorAll('button[aria-label]')].find(item => item.getAttribute('aria-label') === 'Run Resume Subway service');
  const r = button?.getBoundingClientRect();
  return { scrollTop: dialog.scrollTop, rect: r && { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height } };
})()`);
assert(bottomQuickAction.scrollTop > 0 && bottomQuickAction.rect && bottomQuickAction.rect.y >= 0 &&
  bottomQuickAction.rect.bottom <= 424 && bottomQuickAction.rect.height >= 30,
  `Bottom quick action cannot be reached after expanding fields: ${JSON.stringify(bottomQuickAction)}`);
await tapAria('Run Resume Subway service');
await waitFor(`!${visibleDialog}`,
  'The bottom Resume action did not run');
await openQuickActions();
await chooseQuickActionLine('Hibiya', 'to-naka-meguro');
await waitFor(`window.__subwayDashboardCheck.snapshot().line === 'hibiya' && window.__subwayDashboardCheck.snapshot().scene?.snapshot.station === 'H22' && window.__subwayDashboardCheck.snapshot().scene?.snapshot.next === 'H21' && window.__subwayDashboardCheck.snapshot().scene?.snapshot.paused === false`,
  'Quick-action Hibiya change did not restart at the selected default station and direction');
await pause(1_000);
await openQuickActions();
await chooseQuickActionLine('Sakaisuji', 'southbound');
await waitFor(`window.__subwayDashboardCheck.snapshot().line === 'sakaisuji' && window.__subwayDashboardCheck.snapshot().scene?.snapshot.station === 'K11' && window.__subwayDashboardCheck.snapshot().scene?.snapshot.next === 'K12' && window.__subwayDashboardCheck.snapshot().scene?.snapshot.paused === false`,
  'Quick-action Sakaisuji change did not restart at the selected default station and direction');

const nextButton = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button[aria-label="Next page"]')].find(item => {
    if (item.closest('[aria-hidden="true"], [inert]')) return false;
    const frame = item.closest('[data-visible-page]');
    if (frame && frame.getAttribute('data-visible-page') !== 'true') return false;
    const rect = item.getBoundingClientRect();
    return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
  });
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return { height: rect.height };
})()`);
assert(nextButton && nextButton.height >= 22, `Subway page arrow is too small: ${JSON.stringify(nextButton)}`);
await tapAria('Next page');
await waitFor(`window.__subwayDashboardCheck.snapshot().activePage === 'subway-page-2'`, 'Subway next-page arrow did not advance');
await pause(600);
const prevButton = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button[aria-label="Previous page"]')].find(item => {
    if (item.closest('[aria-hidden="true"], [inert]')) return false;
    const frame = item.closest('[data-visible-page]');
    if (frame && frame.getAttribute('data-visible-page') !== 'true') return false;
    const rect = item.getBoundingClientRect();
    return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
  });
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return { height: rect.height };
})()`);
assert(prevButton && prevButton.height >= 22, `Subway page arrow is too small: ${JSON.stringify(prevButton)}`);
await tapAria('Previous page');
await waitFor(`window.__subwayDashboardCheck.snapshot().activePage === 'subway-page-1'`, 'Subway previous-page arrow did not return');
await pause(600);

await tapButton('Display', viewSelector);
await waitFor(`document.querySelector('[data-visible-page="true"] nav[aria-label="Skin view"] button[aria-pressed="true"]')?.textContent.trim() === 'Display'`, 'Display view did not activate');
await viewport(1920, 480);
await waitFor(`(${pixelSample})?.nonBackground > 50`, 'Subway canvas was blank at 1920x480');
const at1920 = await evaluate(pixelSample);
const dashboard1920 = await screenshot('dashboard-1920x480.png');

await viewport(1440, 900);
await call('Page.navigate', { url: `${base}/src/plugins/subway/subway-dashboard.browser.html?view=panel` });
await waitFor(`document.querySelector('nav[aria-label="Main navigation"] button[aria-label="Plugins"]')`, 'Plugin panel did not mount');
await tapAria('Plugins', 'nav[aria-label="Main navigation"] button[aria-label="Plugins"]');
await waitFor(`[...document.querySelectorAll('button')].some(button => button.textContent.includes('Subway skin'))`, 'Subway plugin row did not appear');
await tapButtonContaining('Subway skin');
await waitFor(`document.querySelector('h1')?.textContent.trim() === 'Subway skin' && document.body.innerText.includes('Run speed (next segment)')`,
  'Subway settings did not appear in its plugin detail page');
const pluginLine = await evaluate(`(() => { const item = document.querySelectorAll('button[role="combobox"]')[0]; const r = item.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await tap(pluginLine.x, pluginLine.y);
await waitFor(`document.querySelector('[role="option"]')`, 'Plugin page line options did not open');
await tapOption('Hibiya');
await waitFor(`(() => { const fields = [...document.querySelectorAll('button[role="combobox"]')].map(item => item.textContent.trim()); return fields[1]?.includes('to-kita-senju') && fields[2]?.includes('H01'); })()`,
  'Changing the plugin page line did not normalize direction and start station');
await pause(300);
const pluginFieldValues = await evaluate(`([...document.querySelectorAll('button[role="combobox"]')].slice(0, 3).map(item => item.textContent.trim()))`);
const pluginPage = await screenshot('plugin-subway-settings.png');

await tapAria('Settings', 'nav[aria-label="Main navigation"] button[aria-label="Settings"]');
await waitFor(`document.body.innerText.includes('Settings') && document.querySelector('nav[aria-label="Main navigation"] button[aria-current="page"][aria-label="Settings"]')`,
  'Settings page did not open');
await pause(600);
const settingsText = await evaluate('document.body.innerText');
assert(!settingsText.includes('Run speed (next segment)') && !settingsText.includes('Start station'),
  'Skin-specific settings still appear in Settings');

await tapAria('Layout', 'nav[aria-label="Main navigation"] button[aria-label="Layout"]');
await waitFor(`document.querySelector('[data-skin-host][data-skin-id="subway"] canvas[data-skin-input="scene"]')`, 'Subway layout preview did not mount');
await pause(600);
await waitFor(`(${pixelSample})?.nonBackground > 50`, 'Frozen Subway editor preview remained blank');
const stripItem = await evaluate(`(() => { const item = document.querySelector('[data-skin-slot="strip"] [aria-label^="Move or select"]'); if (!item) return null; const r = item.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
assert(stripItem, 'No control is placed in the Subway strip slot');
await tap(stripItem.x, stripItem.y);
await waitFor(`document.querySelectorAll('[data-corner]').length === 4`, 'Selected strip control did not show four resize handles');
const handleReport = await evaluate(`(() => {
  const handles = [...document.querySelectorAll('[data-corner]')];
  const visible = element => {
    const bounds = element.getBoundingClientRect();
    let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)) { clip.left = Math.max(clip.left, rect.left); clip.right = Math.min(clip.right, rect.right); }
      if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)) { clip.top = Math.max(clip.top, rect.top); clip.bottom = Math.min(clip.bottom, rect.bottom); }
    }
    return bounds.left >= clip.left - 0.5 && bounds.top >= clip.top - 0.5 && bounds.right <= clip.right + 0.5 && bounds.bottom <= clip.bottom + 0.5;
  };
  return handles.map(handle => ({ corner: handle.dataset.corner, visible: visible(handle) }));
})()`);
assert.deepEqual(handleReport.map(handle => handle.corner).sort(), ['ne', 'nw', 'se', 'sw']);
assert(handleReport.every(handle => handle.visible), `Subway strip resize handles are clipped: ${JSON.stringify(handleReport)}`);
const layoutPreview = await screenshot('layout-strip-selected.png');

assert.equal(errors.length, 0, `Browser errors: ${errors.join(' | ')}`);
const report = {
  browser: 'isolated headless Chrome on owned CDP port 9347',
  vite: base,
  tauri: 'mockWindows(main/panel) + mockIPC; browser runtime owner enabled',
  dashboard: { initial, afterTime, changedState, slots: slotCounts, view: ['map', 'run', 'display'], quickActionsMetrics,
    pixels780: at780, pixels1920: at1920, dashboard780, dashboard1920 },
  quickActionsScreenshot, pluginPage, pluginFieldValues,
  layoutPreview: { file: layoutPreview, handles: handleReport },
  errors,
};
await writeFile(path.join(output, 'dashboard-check.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, dashboard780, dashboard1920, quickActionsScreenshot, pluginPage, pluginFieldValues,
  layoutPreview, pixels780: at780, pixels1920: at1920, changedState, slots: slotCounts, handleReport }, null, 2));
socket.close();

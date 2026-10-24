const params = new URLSearchParams(location.search);
const role = params.get('role') === 'panel' ? 'panel' : 'main';
const pageId = 'media-harness-page';
const callbacks = new Map();
let callbackId = 0;

Object.defineProperty(globalThis, 'isTauri', { configurable: true, value: role === 'panel' });

const { mockIPC, mockWindows } = await import('@tauri-apps/api/mocks');
mockWindows(role);
mockIPC(command => command === 'plugin:window|is_visible' ? true : null, { shouldMockEvents: true });
window.__TAURI_INTERNALS__.convertFileSrc = path => {
  window.__mediaConversions.push(path);
  return `data:video/webm;base64,${params.get('video')}`;
};
window.__mediaConversions = [];
window.__TAURI_INTERNALS__.transformCallback = callback => {
  const id = ++callbackId;
  callbacks.set(id, callback);
  return id;
};
window.__TAURI_INTERNALS__.unregisterCallback = id => callbacks.delete(id);

const [{ mount }, { default: MediaControl }, { setMediaContentPages }] = await Promise.all([
  import('svelte'), import('./MediaControl.svelte'), import('../core/content-visibility'),
]);

if (role === 'main') setMediaContentPages([pageId]);
const control = {
  id: 'media-harness', name: 'Media regression', type: 'media',
  variants: [{ id: 'state-1', label: '' }],
  options: { fit: 'cover', interval: 0, loop: true, muted: true, sources: [{
    id: 'video', kind: 'file', value: 'C:/Users/me\\Pictures\\pics\\fixture.webm',
  }] },
};

mount(MediaControl, { target: document.getElementById('app'), props: {
  control, pageId, pageVisible: true, pageRendered: true, itemId: 'media-harness-item',
  pressFeedbackDisabled: role === 'panel',
} });
document.documentElement.dataset.windowRole = role;

const MAX_PRELOADS = 4;
const preloads = new Map<string, HTMLImageElement | HTMLVideoElement>();

function release(controlId: string, resource: HTMLImageElement | HTMLVideoElement) {
  if (preloads.get(controlId) !== resource) return;
  preloads.delete(controlId);
  if (resource instanceof HTMLVideoElement) resource.pause();
  resource.removeAttribute('src');
  if (resource instanceof HTMLVideoElement) resource.load();
}

/** Keep at most four detached next-slide decodes, owned only by visible media widgets. */
export function preloadNextMedia(controlId: string, url: string, video: boolean) {
  const previous = preloads.get(controlId);
  if (previous) release(controlId, previous);
  if (typeof document === 'undefined' || preloads.size >= MAX_PRELOADS || !url) return () => {};
  const resource = video ? document.createElement('video') : new Image();
  if (resource instanceof HTMLVideoElement) {
    resource.muted = true;
    resource.preload = 'metadata';
  } else {
    resource.decoding = 'async';
  }
  preloads.set(controlId, resource);
  resource.src = url;
  if (resource instanceof HTMLVideoElement) resource.load();
  return () => release(controlId, resource);
}

export function mediaPreloadCount() {
  return preloads.size;
}

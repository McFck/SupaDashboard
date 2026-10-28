export type VideoThumbnail = { dataUrl: string; persist: boolean };

const MAX_STORED_THUMBNAIL = 4096;
const MAX_CACHE = 32;
const cache = new Map<string, VideoThumbnail>();
const pending = new Map<string, Promise<VideoThumbnail | undefined>>();

function remember(key: string, value: VideoThumbnail) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
}

export function videoThumbnailKey(source: { kind: string; value: string; id?: string }) {
  return JSON.stringify([source.kind, source.value, source.id ?? '']);
}

export function cachedVideoThumbnail(key: string) {
  const value = cache.get(key);
  if (!value) return;
  remember(key, value);
  return value.dataUrl;
}

export function clearVideoThumbnail(key: string) {
  cache.delete(key);
}

export function captureVideoThumbnail(
  key: string,
  url: string,
): Promise<VideoThumbnail | undefined> {
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing;
  if (typeof document === 'undefined' || !url) return Promise.resolve(undefined);

  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';

  const result = new Promise<VideoThumbnail | undefined>((resolve) => {
    let finished = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const clean = () => {
      if (timeout) clearTimeout(timeout);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    const finish = (value?: VideoThumbnail) => {
      if (finished) return;
      finished = true;
      clean();
      if (value) remember(key, value);
      resolve(value);
    };
    const onError = () => finish();
    const onMetadata = () => {
      if (
        !Number.isFinite(video.duration) ||
        video.duration <= 0 ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0
      ) {
        finish();
        return;
      }
      try {
        video.currentTime = Math.min(1, video.duration * 0.1);
      } catch {
        finish();
      }
    };
    const onSeeked = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish();
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        let best: VideoThumbnail | undefined;
        for (const width of [160, 128, 96, 64, 48]) {
          canvas.width = width;
          canvas.height = Math.max(1, Math.round((width * video.videoHeight) / video.videoWidth));
          const context = canvas.getContext('2d');
          if (!context) {
            finish();
            return;
          }
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          for (const quality of [0.6, 0.42, 0.28]) {
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            const candidate = { dataUrl, persist: dataUrl.length <= MAX_STORED_THUMBNAIL };
            if (!best || dataUrl.length < best.dataUrl.length) best = candidate;
            if (candidate.persist) {
              finish(candidate);
              return;
            }
          }
        }
        finish(best);
      } catch {
        finish();
      }
    };
    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    timeout = setTimeout(() => finish(), 10000);
    video.src = url;
    video.load();
  });
  pending.set(key, result);
  void result.finally(() => {
    if (pending.get(key) === result) pending.delete(key);
  });
  return result;
}

import ImageIcon from '@lucide/svelte/icons/image';
import Video from '@lucide/svelte/icons/video';
import Link from '@lucide/svelte/icons/link';
import { isVideoSource, type MediaSource } from '../../media/content';
export function sourceName(source: MediaSource) {
  const path =
    source.kind === 'url'
      ? (() => {
          try {
            return new URL(source.value).pathname;
          } catch {
            return source.value;
          }
        })()
      : source.value;
  const name = path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || path;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
export function sourceLabel(source: MediaSource) {
  if (source.kind === 'url') {
    return isVideoSource(source) ? 'Video URL' : 'URL';
  }
  if (isVideoSource(source)) {
    return 'Video';
  }
  return /\.gif(?:$|[?#])/i.test(source.value) ? 'GIF' : 'Image';
}
export function sourceIcon(source: MediaSource) {
  if (isVideoSource(source)) {
    return Video;
  }
  return source.kind === 'url' ? Link : ImageIcon;
}

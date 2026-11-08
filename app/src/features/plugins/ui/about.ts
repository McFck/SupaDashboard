// How plugin pages show dates, sizes and outside links.
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'svelte-sonner';

/** An ISO date or Unix milliseconds; 0 is native's "unknown". */
export function formatDate(value?: string | number) {
  const time = typeof value === 'string' ? Date.parse(value) : value;
  return time && Number.isFinite(time)
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(time))
    : '—';
}

/** Bytes. */
export function formatSize(value?: number) {
  if (value === undefined) {
    return '—';
  }
  if (value < 1024) {
    return `${value} B`;
  }
  return value < 1024 * 1024
    ? `${(value / 1024).toFixed(1)} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/** Opens a link in the default browser instead of the app's webview. */
export function followLink(event: MouseEvent, href: string) {
  event.preventDefault();
  if (!isTauri()) {
    window.open(href, '_blank', 'noopener');
    return;
  }
  openUrl(href).catch(() => toast.error('Could not open link'));
}

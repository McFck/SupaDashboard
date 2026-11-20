// Panel-scoped Market catalogue cache with stale-while-revalidate: renders cached entries immediately
// on navigation and app restart, revalidating quietly in the background.
import { isTauri } from '@tauri-apps/api/core';
import { toast } from 'svelte-sonner';
import { pluginCatalogue } from '../../platform/plugin-host';
import { catalogEntries, type CatalogEntry } from './plugin-store';

const STORAGE_KEY = 'market-catalogue-v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

export function readCachedCatalogue(storage: Pick<Storage, 'getItem'>): CatalogEntry[] | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('entries' in parsed)) {
      return null;
    }
    const entries = catalogEntries((parsed as { entries: unknown }).entries);
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

export function writeCachedCatalogue(storage: Pick<Storage, 'setItem'>, raw: unknown) {
  if (catalogEntries(raw).length === 0) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ entries: raw }));
  } catch {
    // Storage can be unavailable or full in embedded/private contexts.
  }
}

function initialEntries(): CatalogEntry[] | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return readCachedCatalogue(localStorage);
}

class MarketCatalogueStore {
  entries = $state<CatalogEntry[]>([]);
  /** True once we have entries to render (either from localStorage cache or a live fetch). */
  hasData = $state(false);
  loading = $state(false);
  /** True only when a fetch failed and there are no cached entries to show. */
  failed = $state(false);
  private fetchedAt = 0;
  private inFlight: Promise<void> | null = null;
  private hydrated = false;

  private hydrate() {
    if (this.hydrated) {
      return;
    }
    this.hydrated = true;
    const cached = initialEntries();
    if (cached) {
      this.entries = cached;
      this.hasData = true;
    }
  }

  ensureLoaded(options: { force?: boolean } = {}): Promise<void> {
    const { force = false } = options;
    this.hydrate();
    if (!isTauri()) {
      this.entries = [];
      this.hasData = true;
      this.loading = false;
      this.failed = false;
      return Promise.resolve();
    }
    if (!force && this.fetchedAt > 0 && Date.now() - this.fetchedAt < CACHE_TTL_MS) {
      return Promise.resolve();
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    this.loading = true;
    if (!this.hasData) {
      this.failed = false;
    }
    const job = pluginCatalogue()
      .then((raw) => {
        const entries = catalogEntries(raw);
        this.entries = entries;
        this.hasData = true;
        this.failed = false;
        this.fetchedAt = Date.now();
        if (typeof localStorage !== 'undefined') {
          writeCachedCatalogue(localStorage, raw);
        }
      })
      .catch((error) => {
        console.error(error);
        if (!this.hasData) {
          this.failed = true;
        } else if (force) {
          toast.error('Could not refresh catalog');
        }
      })
      .finally(() => {
        this.loading = false;
        if (this.inFlight === job) {
          this.inFlight = null;
        }
      });
    this.inFlight = job;
    return job;
  }
}

export const marketCatalogue = new MarketCatalogueStore();

import type { VariableStore } from '../automation/variables';
import type { EventAncestry } from '../plugins/contracts';
import type { Settings } from '../settings/schema';
import { pageAfterRemoval, pageById, pageForFocusedApps, swipeablePages } from './pages';

export type PageChangeReason = 'action' | 'swipe' | 'dot' | 'reconcile' | 'app';

/** Keeps the read-only `page.active` core variable aligned with the shown page. */
export function syncActivePageVariable(variables: VariableStore, pageId: string) {
  if (variables.get('page.active') && variables.getValue('page.active') !== pageId) {
    variables.set('page.active', pageId, 'core');
  }
}

const MAX_HISTORY = 32;

export class PageController {
  activePage: string;
  private priorOrder: string[];
  private history: string[] = [];
  private autoReturnPage: string | undefined;
  private lastAutoPage: string | undefined;

  constructor(
    private readonly host: {
      getDeck(): Settings['deck'];
      isOwner(): boolean;
      onChange(): void;
      emitEvent(
        id: string,
        parameter?: string,
        payload?: unknown,
        ancestry?: EventAncestry,
      ): Promise<void>;
      onEventFailure(): void;
    },
  ) {
    const deck = host.getDeck();
    this.priorOrder = deck.pages.map((page) => page.id);
    const initial =
      deck.pages.find((page) => page.id === deck.activePage && !page.hidden) ??
      swipeablePages(deck.pages)[0] ??
      pageById(deck.pages, deck.activePage);
    this.activePage = initial?.id ?? this.priorOrder[0] ?? 'page-1';
    if (host.isOwner()) {
      deck.activePage = this.activePage;
    }
  }

  change(
    pageId: string,
    reason: PageChangeReason = 'action',
    ancestry?: EventAncestry,
    options: { pushHistory?: boolean } = {},
  ) {
    const deck = this.host.getDeck();
    if (
      !this.host.isOwner() ||
      !deck.pages.some((page) => page.id === pageId) ||
      pageId === this.activePage
    ) {
      return false;
    }
    const previousPage = this.activePage;
    if (options.pushHistory !== false && reason !== 'reconcile' && reason !== 'app') {
      if (this.history.at(-1) !== previousPage) {
        this.history.push(previousPage);
        if (this.history.length > MAX_HISTORY) {
          this.history.shift();
        }
      }
    }
    if (reason === 'action' || reason === 'swipe' || reason === 'dot') {
      this.autoReturnPage = undefined;
    }
    this.activePage = pageId;
    deck.activePage = pageId;
    this.host.onChange();
    void this.host
      .emitEvent(
        'page.changed',
        pageId,
        { previousPage, page: pageId, reason },
        ancestry ? structuredClone(ancestry) : undefined,
      )
      .catch(() => {
        try {
          this.host.onEventFailure();
        } catch {
          /* a failure sink must not interrupt page navigation */
        }
      });
    return true;
  }

  back(ancestry?: EventAncestry) {
    const pages = this.host.getDeck().pages;
    while (this.history.length) {
      const target = this.history.pop()!;
      if (target !== this.activePage && pages.some((page) => page.id === target)) {
        return this.change(target, 'action', ancestry, { pushHistory: false });
      }
    }
    return false;
  }

  changeInDirection(
    direction: 'next' | 'prev',
    reason: PageChangeReason = 'action',
    ancestry?: EventAncestry,
  ) {
    if (!this.host.isOwner()) {
      return false;
    }
    const pages = swipeablePages(this.host.getDeck().pages);
    if (!pages.length) {
      return false;
    }
    const index = pages.findIndex((page) => page.id === this.activePage);
    if (index < 0) {
      const fallback = direction === 'next' ? pages[0] : pages.at(-1)!;
      return this.change(fallback.id, reason, ancestry);
    }
    if (pages.length < 2) {
      return false;
    }
    const next = (index + (direction === 'next' ? 1 : pages.length - 1)) % pages.length;
    return this.change(pages[next].id, reason, ancestry);
  }

  /** Switches to a page bound to a focused app, returning to the prior manual page when unfocused. */
  syncFocusedApps(focusedKeys: ReadonlySet<string>) {
    if (!this.host.isOwner()) {
      return false;
    }
    const pages = this.host.getDeck().pages;
    const matched = pageForFocusedApps(pages, focusedKeys);
    if (matched) {
      if (matched.id === this.lastAutoPage) {
        return false;
      }
      if (!this.lastAutoPage && matched.id !== this.activePage) {
        this.autoReturnPage = this.activePage;
      }
      this.lastAutoPage = matched.id;
      return this.change(matched.id, 'app');
    }
    if (!this.lastAutoPage) {
      return false;
    }
    const previousAuto = this.lastAutoPage;
    const returnTo = this.autoReturnPage;
    this.lastAutoPage = undefined;
    this.autoReturnPage = undefined;
    if (
      returnTo &&
      this.activePage === previousAuto &&
      pages.some((page) => page.id === returnTo)
    ) {
      return this.change(returnTo, 'app');
    }
    return false;
  }

  reconcile(pages = this.host.getDeck().pages) {
    const valid = new Set(pages.map((page) => page.id));
    this.history = this.history.filter((id) => valid.has(id));
    if (this.autoReturnPage && !valid.has(this.autoReturnPage)) {
      this.autoReturnPage = undefined;
    }
    if (this.lastAutoPage && !valid.has(this.lastAutoPage)) {
      this.lastAutoPage = undefined;
    }
    const active = pageById(pages, this.activePage);
    if (!active) {
      return;
    }
    if (active.id !== this.activePage) {
      const next = pageAfterRemoval(pages, this.activePage, this.priorOrder) ?? active.id;
      this.change(next, 'reconcile');
    }
    this.priorOrder = pages.map((page) => page.id);
  }
}

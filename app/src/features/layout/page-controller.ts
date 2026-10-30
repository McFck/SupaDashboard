import type { EventAncestry } from '../plugins/contracts';
import type { Settings } from '../settings/schema';
import { pageAfterRemoval, pageById } from './pages';

export type PageChangeReason = 'action' | 'swipe' | 'dot' | 'reconcile';

export class PageController {
  activePage: string;
  private priorOrder: string[];

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
    this.activePage = pageById(deck.pages, deck.activePage)?.id ?? this.priorOrder[0] ?? 'page-1';
    if (host.isOwner()) {
      deck.activePage = this.activePage;
    }
  }

  change(pageId: string, reason: PageChangeReason = 'action', ancestry?: EventAncestry) {
    const deck = this.host.getDeck();
    if (
      !this.host.isOwner() ||
      !deck.pages.some((page) => page.id === pageId) ||
      pageId === this.activePage
    ) {
      return false;
    }
    const previousPage = this.activePage;
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

  changeInDirection(
    direction: 'next' | 'prev',
    reason: PageChangeReason = 'action',
    ancestry?: EventAncestry,
  ) {
    if (!this.host.isOwner()) {
      return false;
    }
    const pages = this.host.getDeck().pages;
    const index = pages.findIndex((page) => page.id === this.activePage);
    if (index < 0 || pages.length < 2) {
      return false;
    }
    const next = (index + (direction === 'next' ? 1 : pages.length - 1)) % pages.length;
    return this.change(pages[next].id, reason, ancestry);
  }

  reconcile(pages = this.host.getDeck().pages) {
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

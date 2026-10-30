import { applets } from '../plugins/registry';
import type { Page } from '../settings/schema';
import DeckApplet from './deck/DeckApplet.svelte';
import type { AppletDef } from './contracts';

/** The built-in applet: pages without `applet`, or whose applet is not registered, render as deck. */
export const DECK: AppletDef = {
  id: 'deck',
  title: 'Deck',
  component: DeckApplet,
  slots: [{ id: 'main', kind: 'grid', grid: 'page' }],
  views: [{ id: 'default', title: 'Deck' }],
  defaultView: 'default',
};

export function appletFor(page: Pick<Page, 'applet'>): AppletDef {
  return (page.applet ? applets.get(page.applet) : undefined) ?? DECK;
}

export function appletById(id: string): AppletDef | undefined {
  return id === DECK.id ? DECK : applets.get(id);
}

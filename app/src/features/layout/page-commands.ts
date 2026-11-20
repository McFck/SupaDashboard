// Page edits applied to the live settings as one undo step each. They return the page to select afterwards.
import { isAppKey } from '../apps/keys';
import { settings } from '../settings/state.svelte';
import { commit } from './history.svelte';
import {
  addPage as buildAddPage,
  deletePage as buildDeletePage,
  duplicatePage as buildDuplicatePage,
  pageAfterRemoval,
  renamePage as buildRenamePage,
  reorderPage as buildReorderPage,
} from './pages';

/** Adds a blank page using `templateId`'s geometry; undefined at the page limit. */
export function addPage(templateId: string) {
  const result = buildAddPage(
    settings.deck.pages,
    settings.controls,
    templateId,
    settings.appletLayouts,
  );
  if (!result) {
    return undefined;
  }
  commit('Add page');
  settings.deck.pages = result.pages;
  return result.page.id;
}

export function renamePage(pageId: string, name: string) {
  const result = buildRenamePage(settings.deck.pages, pageId, name);
  if (!result) {
    return false;
  }
  commit('Rename page');
  settings.deck.pages = result.pages;
  return true;
}

/** Copies a page with new controls and placements; undefined at the page limit or when copying fails. */
export function duplicatePage(pageId: string) {
  const result = buildDuplicatePage(
    settings.deck.pages,
    pageId,
    settings.controls,
    settings.variants,
    settings.appletLayouts,
  );
  if (!result) {
    return undefined;
  }
  commit('Duplicate page');
  settings.deck.pages = result.pages;
  settings.controls = result.controls;
  settings.variants = result.variants;
  settings.appletLayouts = result.appletLayouts;
  return result.page.id;
}

/** Shows `appletId` on the page, or the deck when absent. The page keeps the layouts of every applet it has used. */
export function setPageApplet(pageId: string, appletId: string | undefined) {
  const page = settings.deck.pages.find((entry) => entry.id === pageId);
  if (!page || page.applet === appletId) {
    return;
  }
  commit('Change applet');
  const { applet: _previous, ...rest } = page;
  const next = appletId ? { ...rest, applet: appletId } : rest;
  settings.deck.pages = settings.deck.pages.map((entry) => (entry.id === pageId ? next : entry));
}

/** Excludes or includes a page in swipe navigation and page dots. */
export function setPageHidden(pageId: string, hidden: boolean) {
  const page = settings.deck.pages.find((entry) => entry.id === pageId);
  if (!page || Boolean(page.hidden) === hidden) {
    return;
  }
  commit(hidden ? 'Hide page from swipe' : 'Show page in swipe');
  const { hidden: _previous, ...rest } = page;
  const next = hidden ? { ...rest, hidden: true } : rest;
  settings.deck.pages = settings.deck.pages.map((entry) => (entry.id === pageId ? next : entry));
}

/** Binds apps that automatically switch the dashboard to this page when focused. */
export function setPageApps(pageId: string, apps: readonly string[]) {
  const page = settings.deck.pages.find((entry) => entry.id === pageId);
  if (!page) {
    return;
  }
  const clean = [...new Set(apps.filter(isAppKey))];
  if (JSON.stringify(page.apps ?? []) === JSON.stringify(clean)) {
    return;
  }
  commit('Page apps');
  const { apps: _previous, ...rest } = page;
  const next = clean.length ? { ...rest, apps: clean } : rest;
  settings.deck.pages = settings.deck.pages.map((entry) => (entry.id === pageId ? next : entry));
}

export function reorderPage(pageId: string, index: number) {
  const result = buildReorderPage(settings.deck.pages, pageId, index);
  if (!result) {
    return;
  }
  commit('Reorder pages');
  settings.deck.pages = result.pages;
}

/** Deletes a page and its unshared controls; returns the page that takes its place in the tab order. */
export function deletePage(pageId: string) {
  const pages = settings.deck.pages;
  const order = pages.map((entry) => entry.id);
  const result = buildDeletePage(
    pages,
    pageId,
    settings.controls,
    settings.variants,
    settings.appletLayouts,
  );
  if (!result) {
    return undefined;
  }
  commit('Delete page');
  settings.deck.pages = result.pages;
  settings.controls = result.controls;
  settings.variants = result.variants;
  settings.appletLayouts = result.appletLayouts;
  return pageAfterRemoval(result.pages, pageId, order) ?? result.pages[0].id;
}

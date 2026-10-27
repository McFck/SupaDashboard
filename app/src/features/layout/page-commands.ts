// Page edits applied to the live settings as one undo step each. They return the page to select afterwards.
import { settings } from '../settings/state.svelte';
import { commit } from './history.svelte';
import {
  addPage as buildAddPage,
  deletePage as buildDeletePage,
  duplicatePage as buildDuplicatePage,
  MAX_PAGES,
  pageAfterRemoval,
  renamePage as buildRenamePage,
  reorderPage as buildReorderPage,
} from './pages';

/** Adds a blank page using `templateId`'s geometry; undefined at the page limit. */
export function addPage(templateId: string) {
  if (settings.deck.pages.length >= MAX_PAGES) {
    return undefined;
  }
  const result = buildAddPage(
    settings.deck.pages,
    settings.controls,
    templateId,
    settings.skinLayouts,
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
  if (settings.deck.pages.length >= MAX_PAGES) {
    return undefined;
  }
  const result = buildDuplicatePage(
    settings.deck.pages,
    pageId,
    settings.controls,
    settings.variants,
    settings.skinLayouts,
  );
  if (!result) {
    return undefined;
  }
  commit('Duplicate page');
  settings.deck.pages = result.pages;
  settings.controls = result.controls;
  settings.variants = result.variants;
  settings.skinLayouts = result.skinLayouts;
  return result.page.id;
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
  if (pages.length <= 1 || !pages.some((entry) => entry.id === pageId)) {
    return undefined;
  }
  const order = pages.map((entry) => entry.id);
  const result = buildDeletePage(
    pages,
    pageId,
    settings.controls,
    settings.variants,
    settings.skinLayouts,
  );
  if (!result) {
    return undefined;
  }
  commit('Delete page');
  settings.deck.pages = result.pages;
  settings.controls = result.controls;
  settings.variants = result.variants;
  settings.skinLayouts = result.skinLayouts;
  return pageAfterRemoval(result.pages, pageId, order) ?? result.pages[0].id;
}

// Persisted settings shape (v7).
import type { ControlConfig } from '../controls/model';
import type { DeckSizing, Item } from '../layout/grid';

export type Page = {
  id: string;
  name: string;
  rows: number;
  cols: number;
  /** Cell edge in px and spacing between cells. */
  size: number;
  sizing: DeckSizing;
  gap: number;
  items: Item[];
};

export type Deck = { pages: Page[]; activePage: string };

export type Settings = {
  version: 7;
  skin: string;
  display: {
    monitor: string | null;
    fullscreen: boolean;
    alwaysOnTop: boolean;
    /** Backdrop behind the widgets on the transparent dashboard window. */
    background: { color: string; opacity: number; radius: number };
  };
  controls: ControlConfig[];
  deck: Deck;
  skinSettings: Record<string, Record<string, unknown>>;
  skinLayouts: Record<string, Record<string, Record<string, Item[]>>>;
  /** control id -> active variant (gesture swaps are sticky across restarts) */
  variants: Record<string, number>;
};

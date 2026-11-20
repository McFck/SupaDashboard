// Persisted settings shape.
import type { Predicate } from '../automation/scenario';
import type { ControlConfig } from '../controls/model';
import type { DeckSizing, Item } from '../layout/grid';

export type PageAutoSwitch = {
  /** Any matching rule switches the dashboard to this page. */
  rules: Predicate[];
  /** Return to the previous manual page when no rules match anymore. */
  returnOnLeave: boolean;
};

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
  /** Applet shown on this page; absent means the built-in deck. Unknown ids are kept. */
  applet?: string;
  /** Excluded from left/right swipe and page dots; entered via actions or auto-switch rules. */
  hidden?: boolean;
  /** Condition rules that automatically switch the dashboard to this page. */
  autoSwitch?: PageAutoSwitch;
};

export type AppletSettingsEntry = {
  shared: Record<string, unknown>;
  /** Pages use `perPage` values (falling back to `shared`); `perPage` is kept when this is switched off. */
  separate: boolean;
  perPage?: Record<string, Record<string, unknown>>;
};

export type Deck = { pages: Page[]; activePage: string };

export type Settings = {
  version: 24;
  display: {
    monitor: string | null;
    monitorLabel: string | null;
    fullscreen: boolean;
    alwaysOnTop: boolean;
    /** Action icon size as a multiple of the default glyph, for every page and applet. */
    iconScale: number;
    labelScale: number;
    /** Backdrop behind the widgets on the transparent dashboard window: the colour, or the live desktop wallpaper. */
    background: { mode: 'color' | 'wallpaper'; color: string; opacity: number; radius: number };
  };
  controls: ControlConfig[];
  deck: Deck;
  appletSettings: Record<string, AppletSettingsEntry>;
  appletLayouts: Record<string, Record<string, Record<string, Item[]>>>;
  /** control id -> active variant (gesture swaps are sticky across restarts) */
  variants: Record<string, number>;
  /** App keys the user added by hand (`aumid:…` / `exe:…`), kept for the app picker's suggestions. */
  apps: string[];
};

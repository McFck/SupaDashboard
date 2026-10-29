import { getContext } from 'svelte';
import type { ControlConfig, TilePresentation } from '../controls/model';
import type { AppletConfig, AppletDef } from './contracts';
import type { Page } from '../settings/schema';
import type { VariableValue } from '../automation/variables';
import type { SceneInput, SceneRect } from './scene-contracts';
import type { Selection } from '../layout/grid';
import type { LayoutTarget } from '../layout/applet-layouts';

export const APPLET_HOST_CONTEXT = Symbol('applet-host');

export type AppletPageContext = Page & { next(): Promise<boolean>; prev(): Promise<boolean> };

export type AppletHostContext = {
  mode: 'runtime' | 'editor';
  applet: AppletDef;
  page: AppletPageContext;
  viewId: string;
  designScale: number;
  designOffset: { x: number; y: number };
  viewport?: { width: number; height: number };
  setDesignHeight?(height: number): void;
  config: AppletConfig;
  state: Readonly<Record<string, VariableValue>>;
  visible: boolean;
  pageRenderVisible: boolean;
  /** Frame visible, tab visible and scrolled into view; the editor preview counts. */
  onScreen: boolean;
  /** Runtime only: this window owns the runtime and its tab and the dashboard are visible. */
  windowLive: boolean;
  /** Runtime only: a page showing this applet is live and on screen. */
  active: boolean;
  resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation;
  selected: Selection;
  onselect?(selection: Selection, target?: LayoutTarget): void;
  oncontext?(
    selection: Exclude<Selection, null>,
    x: number,
    y: number,
    target?: LayoutTarget,
  ): void;
  setView(viewId: string): Promise<boolean>;
  routeSceneInput(
    input: SceneInput,
    rect: SceneRect,
    deliver: (input: SceneInput) => void,
  ): boolean;
  resetSceneInput(): void;
  quickActionsOpen: boolean;
  setQuickActionsOpen(open: boolean): void;
};

export function getAppletHostContext() {
  return getContext<AppletHostContext | undefined>(APPLET_HOST_CONTEXT);
}

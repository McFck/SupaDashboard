import { getContext } from 'svelte';
import type { ControlConfig, TilePresentation } from '../core/controls';
import type { SkinConfig, SkinDef } from '../core/skins';
import type { Page } from '../core/settings.svelte';
import type { VariableValue } from '../core/variables';
import type { SceneInput, SceneRect } from '../core/skin-scene';
import type { Selection } from '../core/layout';
import type { LayoutTarget } from '../core/skin-layouts';

export const SKIN_HOST_CONTEXT = Symbol('skin-host');

export type SkinPageContext = Page & { next(): Promise<boolean>; prev(): Promise<boolean> };

export type SkinHostContext = {
  mode: 'runtime' | 'editor';
  skin: SkinDef;
  page: SkinPageContext;
  viewId: string;
  designScale: number;
  designOffset: { x: number; y: number };
  viewport?: { width: number; height: number };
  setDesignHeight?(height: number): void;
  config: SkinConfig;
  state: Readonly<Record<string, VariableValue>>;
  visible: boolean;
  pageRenderVisible: boolean;
  resolvePresentation?: (control: ControlConfig, variantIndex: number) => TilePresentation;
  selected: Selection;
  onselect?(selection: Selection, target?: LayoutTarget): void;
  oncontext?(selection: Exclude<Selection, null>, x: number, y: number, target?: LayoutTarget): void;
  setView(viewId: string): Promise<boolean>;
  routeSceneInput(input: SceneInput, rect: SceneRect, deliver: (input: SceneInput) => void): boolean;
  resetSceneInput(): void;
  quickActionsOpen: boolean;
  setQuickActionsOpen(open: boolean): void;
};

export function getSkinHostContext() {
  return getContext<SkinHostContext | undefined>(SKIN_HOST_CONTEXT);
}

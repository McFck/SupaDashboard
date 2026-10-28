import type { Component } from 'svelte';
import type { Readable } from 'svelte/store';
import type { ActionRef, EventDef, Param } from '../plugins/contracts';
import type { ControlFaceProps } from '../controls/model';
import type { Page } from '../settings/schema';
import type { VariableType, VariableValue } from '../automation/variables';

export type SkinRect = { x: number; y: number; w: number; h: number };
export type SkinDesignFit = { scale: number; offsetX: number; offsetY: number };

export type SkinGrid =
  'page' | { rows: number; cols: number; size: number; gap: number; sizing: 'auto' | 'manual' };
export type SkinSlot = {
  id: string;
  style: 'region' | 'anchored';
  kind: 'grid' | 'strip';
  rect?: SkinRect;
  accepts?: string[];
  max?: number;
  size?: { w: number; h: number };
  grid: SkinGrid;
};
export type SkinView = { id: string; title: string; slots: string[] };
export type SkinStateField = {
  key: string;
  type: VariableType;
  initialValue: VariableValue;
  persistent?: boolean;
};
export type SkinPageNavigation = 'swipe' | 'skin';
export type SkinAlter = 'layout' | 'logic';
export type SkinConfig = Readonly<Record<string, unknown>>;
export type SkinRuntimeContext = {
  config: Readable<SkinConfig>;
  getState(key: string): VariableValue | undefined;
  setState(
    key: string,
    value: VariableValue,
    ancestry?: { depth: number; listeners: string[] },
  ): Promise<boolean>;
  setView(viewId: string, ancestry?: { depth: number; listeners: string[] }): Promise<boolean>;
  emitEvent(
    id: string,
    parameter?: string,
    payload?: unknown,
    ancestry?: { depth: number; listeners: string[] },
  ): Promise<void>;
};
export type SkinControlFace = {
  component: Component<ControlFaceProps>;
  sizes?: Record<
    string,
    {
      min: { w: number; h: number };
      default: { w: number; h: number };
      max?: { w: number; h: number };
    }
  >;
};

export type SkinDef = {
  plugin?: string;
  id: string;
  title: string;
  component: Component<{ page: Page }>;
  alters?: SkinAlter[];
  design?: { width: number; height: number };
  slots: SkinSlot[];
  views: SkinView[];
  defaultView: string;
  pageNavigation?: SkinPageNavigation;
  controlSkins?: Record<string, SkinControlFace>;
  settings?: Param[];
  quickActions?: ActionRef[];
  state?: SkinStateField[];
  events?: Omit<EventDef, 'plugin'>[];
  runtime?: (context: SkinRuntimeContext) => void | (() => void);
};

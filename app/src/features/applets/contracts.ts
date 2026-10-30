import type { Component } from 'svelte';
import type { Readable } from 'svelte/store';
import type { ActionRef, EventDef, Param, SettingsGroup } from '../plugins/contracts';
import type { ControlFaceProps } from '../controls/model';
import type { Page } from '../settings/schema';
import type { VariableType, VariableValue } from '../automation/variables';

export type AppletGrid =
  'page' | { rows: number; cols: number; size: number; gap: number; sizing: 'auto' | 'manual' };
export type AppletSlot = {
  id: string;
  kind: 'grid' | 'strip';
  accepts?: string[];
  max?: number;
  size?: { w: number; h: number };
  grid: AppletGrid;
};
export type AppletView = { id: string; title: string; slots: string[] };
export type AppletStateField = {
  key: string;
  type: VariableType;
  initialValue: VariableValue;
  persistent?: boolean;
};
export type AppletConfig = Readonly<Record<string, unknown>>;
export type AppletRuntimeContext = {
  config: Readable<AppletConfig>;
  /** True while a page showing this applet is live: visible, on screen, and this window is the owner. */
  active: Readable<boolean>;
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
export type AppletControlFace = {
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

export type AppletDef = {
  plugin?: string;
  id: string;
  title: string;
  component: Component<{ page: Page }>;
  design?: { width: number; height: number };
  slots: AppletSlot[];
  views: AppletView[];
  defaultView: string;
  controlFaces?: Record<string, AppletControlFace>;
  /** Loose params and groups may be mixed; loose ones form a "General" group. */
  settings?: (Param | SettingsGroup)[];
  quickActions?: ActionRef[];
  state?: AppletStateField[];
  events?: Omit<EventDef, 'plugin'>[];
  start?: (context: AppletRuntimeContext) => void | (() => void);
};

// Control configuration as stored in settings, and the props control faces receive.
import type { ActionRef, ValueRef } from '../plugins/contracts';
import type { Scenario, StateBinding, StateRoles } from '../automation/scenario';
import { sliderOrientation } from './geometry';
import type { PullSnapshot } from './input/pull';

export const DEFAULT_MIXER_MAX_CHANNELS = 6;

/** Legacy trigger names accepted only while migrating older saved controls. */
export type Gesture =
  'tap' | 'doubleTap' | 'longPress' | 'swipeUp' | 'swipeDown' | 'swipeLeft' | 'swipeRight';

export type SwipeGesture = Extract<Gesture, `swipe${string}`>;

/** One mode of a control: prev for all media vs prev for Spotify only, system vs Spotify volume. */
export type Variant = {
  id?: string;
  label: string;
  icon?: string | null;
  color?: string | null;
  background?: string | null;
  /** Legacy action source, removed by normalizeControl. */ action?: ActionRef;
  value?: ValueRef;
};
/** A resolved, presentation-only view supplied by ACTIONS; these fields are never persisted here. */
export type TileAppearance = Pick<Variant, 'label' | 'icon' | 'color' | 'background'>;
export type TilePresentation = { key: string; view: TileAppearance };
export type SliderFaceState = {
  level: number | null;
  muted: boolean;
  orientation: 'vertical' | 'horizontal';
  active: boolean;
  fillReady: boolean;
  animateFill: boolean;
  sourceKey: string;
  accent: string;
};
export type ControlFaceProps = {
  appearance: TileAppearance;
  presentation: TilePresentation;
  stateId: string;
  stateIndex: number;
  busy: boolean;
  pull: PullSnapshot | null;
  compact: boolean;
  pixelWidth: number;
  pixelHeight: number;
  slider?: SliderFaceState;
};

/** A gesture either runs an action or switches the control to another variant. */
export type GestureBinding = ActionRef | { variant: 'next' | 'prev' | number };

/** Most states a control can have. */
export const MAX_VARIANTS = 4;

export type ControlConfig = {
  id: string;
  /** Internal editor name; tiles use the active variant label, including an empty label. */
  name: string;
  type: string; // 'button' | 'slider' | a plugin's control type
  /** Legacy field, migrated to variant colours on load. */
  color?: string;
  /** Widget-specific settings, e.g. the volume mixer's channels. */
  options?: Record<string, unknown>;
  variants: Variant[];
  scenario?: Scenario;
  stateBinding?: StateBinding;
  stateRoles?: StateRoles;
  /** Legacy trigger source, removed by normalizeControl. */
  gestures?: Partial<Record<Gesture, GestureBinding>>;
};

/** Gestures a widget can use: sliders keep their drag axis for the value, so only cross-axis swipes remain. */
export function availableGestures(type: string, w: number, h: number, compact = false): Gesture[] {
  if (type === 'button' || type === 'media' || type === 'web')
    return ['swipeDown', 'swipeUp', 'swipeLeft', 'swipeRight', 'longPress', 'doubleTap'];
  if (type === 'slider')
    return !compact && sliderOrientation(w, h) === 'vertical'
      ? ['swipeLeft', 'swipeRight', 'longPress', 'doubleTap']
      : ['swipeDown', 'swipeUp', 'longPress', 'doubleTap'];
  return [];
}

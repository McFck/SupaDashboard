// Control configuration as stored in settings, plus pure edits of a control's states.
import type { ActionRef, ValueRef } from '../plugins/contracts';
import type { Scenario, StateBinding, StateRoles, ActionStep } from '../automation/scenario';
import { sliderOrientation } from './geometry';
import type { PullSnapshot } from './interaction';

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

/** Move a state; scenario references use stable IDs. Returns the reordered current index. */
export function moveVariant(
  control: ControlConfig,
  current: number,
  from: number,
  to: number,
): number {
  const n = control.variants.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return current;
  const [moved] = control.variants.splice(from, 1);
  control.variants.splice(to, 0, moved);
  const remap = (i: number) =>
    i === from
      ? to
      : from < to && i > from && i <= to
        ? i - 1
        : from > to && i >= to && i < from
          ? i + 1
          : i;
  return remap(current);
}

/** Remove a state and repair only references scoped to that control. */
export function removeVariant(control: ControlConfig, current: number, index: number): number {
  const n = control.variants.length;
  if (n < 2 || index < 0 || index >= n) return current;
  const removedId = control.variants[index].id ?? `state-${index + 1}`;
  const replacement = control.variants[Math.min(index, n - 2)];
  const replacementId = replacement.id ?? `state-${Math.min(index, n - 2) + 1}`;
  control.variants.splice(index, 1);
  const remap = (i: number) => (i === index ? Math.min(index, n - 2) : i > index ? i - 1 : i);

  const visit = (steps: ActionStep[] = []) => {
    for (const step of steps) {
      if (
        step.kind === 'action' &&
        step.action.id === 'button.variant' &&
        step.action.args?.target === 'self' &&
        step.action.args.variant === removedId
      )
        step.action.args.variant = replacementId;
      else if (step.kind === 'if') {
        visit(step.then);
        visit(step.else);
      }
    }
  };
  for (const list of Object.values(control.scenario?.triggers ?? {})) {
    if (!list) continue;
    delete list.byState?.[removedId];
    visit(list.steps);
    for (const steps of Object.values(list.byState ?? {})) visit(steps);
  }
  for (const event of control.scenario?.events ?? []) {
    delete event.list.byState?.[removedId];
    visit(event.list.steps);
    for (const steps of Object.values(event.list.byState ?? {})) visit(steps);
  }
  if (control.stateBinding)
    control.stateBinding.cases = control.stateBinding.cases.filter(
      (item) => item.stateId !== removedId,
    );
  if (
    control.stateRoles &&
    (control.stateRoles.off === removedId || control.stateRoles.on === removedId)
  )
    delete control.stateRoles;
  return remap(current);
}

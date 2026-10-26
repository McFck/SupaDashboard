import type {
  ControlFaceProps,
  SliderFaceState,
  TileAppearance,
} from '../../../features/controls/model';
import type { PullSnapshot } from '../../../features/controls/interaction';

const LINE_ACCENTS: Record<string, string> = {
  yamanote: '#79b52c',
  hibiya: '#9caeb7',
  sakaisuji: '#bc782d',
};

export function subwayAccent(lineId: unknown, appearance: TileAppearance): string {
  return (
    appearance.color ?? (typeof lineId === 'string' ? LINE_ACCENTS[lineId] : undefined) ?? '#94a3b8'
  );
}

export function facePullTransform(pull: PullSnapshot | null): string | undefined {
  if (!pull) return undefined;
  return pull.axis === 'x' ? `translateX(${pull.offset}px)` : `translateY(${pull.offset}px)`;
}

export function subwayButtonFaceModel(props: ControlFaceProps, lineId: unknown) {
  return {
    label: props.appearance.label,
    icon: props.appearance.icon,
    color: subwayAccent(lineId, props.appearance),
    background: props.appearance.background,
    compact: props.compact,
    busy: props.busy,
    transform: facePullTransform(props.pull),
    disabledVisual: props.busy,
  };
}

export function subwaySliderFaceModel(props: ControlFaceProps, lineId: unknown) {
  const slider: SliderFaceState = props.slider ?? {
    level: null,
    muted: false,
    orientation: 'vertical',
    active: false,
    fillReady: false,
    animateFill: false,
    sourceKey: '',
    accent: subwayAccent(lineId, props.appearance),
  };
  const level =
    typeof slider.level === 'number' && Number.isFinite(slider.level)
      ? Math.max(0, Math.min(1, slider.level))
      : 0;
  return {
    label: props.appearance.label,
    icon: props.appearance.icon,
    color: subwayAccent(lineId, props.appearance),
    background: props.appearance.background,
    compact: props.compact,
    busy: props.busy,
    level,
    muted: slider.muted,
    orientation: slider.orientation,
    active: slider.active,
    fillReady: slider.fillReady,
    transition: slider.animateFill ? 'transform 190ms ease-out' : 'none',
    transform: facePullTransform(props.pull),
    disabledVisual: props.busy || !slider.active,
    sourceKey: slider.sourceKey,
  };
}

import { describe, expect, it } from 'vitest';
import { subwayButtonFaceModel, subwaySliderFaceModel } from './faces';
import type { ControlFaceProps } from '../../core/controls';

const base = {
  appearance: { label: 'Platform', icon: 'TrainFront', color: null, background: null },
  presentation: { key: 'main', view: { label: 'Platform', icon: 'TrainFront', color: null, background: null } },
  stateId: 'main', stateIndex: 0, busy: false, pull: { pointerId: 1, axis: 'x', direction: 'swipeRight', offset: 36,
    distance: 48, progress: 1, threshold: 48, armed: true, effect: { kind: 'scenario', trigger: 'swipeRight', title: 'Pull right' } },
  compact: false, pixelWidth: 112, pixelHeight: 112,
} satisfies ControlFaceProps;

describe('Subway control face mapping', () => {
  it('maps resolved button appearance and pull preview without replacing input props', () => {
    expect(subwayButtonFaceModel(base, 'hibiya')).toMatchObject({ label: 'Platform', icon: 'TrainFront', color: '#9caeb7',
      background: null, transform: 'translateX(36px)', busy: false, compact: false });
  });

  it('maps slider value, orientation, mute, compact and transform-only fill animation', () => {
    const slider = subwaySliderFaceModel({ ...base, slider: { level: 1.4, muted: true, orientation: 'horizontal',
      active: true, fillReady: true, animateFill: true, sourceKey: 'subway', accent: '#bc782d' } }, 'sakaisuji');
    expect(slider).toMatchObject({ level: 1, muted: true, orientation: 'horizontal', active: true, fillReady: true,
      transition: 'transform 190ms ease-out', sourceKey: 'subway', transform: 'translateX(36px)', color: '#bc782d' });
  });
});


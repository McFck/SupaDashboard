import { describe, expect, it } from 'vitest';
import { availableGestures } from './model';

describe('available gestures', () => {
  it('offers double taps and reserves the slider value axis', () => {
    expect(availableGestures('button', 1, 1)).toContain('doubleTap');
    expect(availableGestures('media', 2, 2)).toContain('swipeLeft');
    expect(availableGestures('web', 3, 2)).toContain('longPress');
    expect(availableGestures('slider', 1, 3)).toEqual([
      'swipeLeft',
      'swipeRight',
      'longPress',
      'doubleTap',
    ]);
    expect(availableGestures('slider', 3, 1)).toEqual([
      'swipeDown',
      'swipeUp',
      'longPress',
      'doubleTap',
    ]);
  });
  it('blocks the slider value axis using slot pixels and compact strip orientation', () => {
    expect(availableGestures('slider', 112, 352)).toContain('swipeLeft');
    expect(availableGestures('slider', 112, 352)).not.toContain('swipeUp');
    expect(availableGestures('slider', 112, 112, true)).toContain('swipeUp');
    expect(availableGestures('slider', 112, 112, true)).not.toContain('swipeLeft');
  });
});

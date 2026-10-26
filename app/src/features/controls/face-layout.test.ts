import { describe, expect, it } from 'vitest';
import { buttonLabelVisible, sliderFaceText } from './face-layout';

describe('face text thresholds', () => {
  it('hides button labels below a readable footprint', () => {
    expect(buttonLabelVisible(103, 200)).toBe(false);
    expect(buttonLabelVisible(104, 88)).toBe(true);
  });

  it('hides slider names before percentages as a vertical strip narrows', () => {
    expect(sliderFaceText(44, 180, true)).toEqual({ name: false, percentage: false });
    expect(sliderFaceText(64, 180, true)).toEqual({ name: false, percentage: true });
    expect(sliderFaceText(87, 180, true)).toEqual({ name: false, percentage: true });
    expect(sliderFaceText(88, 140, true)).toEqual({ name: true, percentage: true });
  });

  it('uses the long axis for horizontal sliders', () => {
    expect(sliderFaceText(100, 44, false)).toEqual({ name: false, percentage: false });
    expect(sliderFaceText(120, 44, false)).toEqual({ name: false, percentage: true });
    expect(sliderFaceText(176, 40, false)).toEqual({ name: true, percentage: true });
  });
});

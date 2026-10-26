export type SliderFaceText = { name: boolean; percentage: boolean };

export function buttonLabelVisible(width: number, height: number) {
  return width >= 104 && height >= 88;
}

export function sliderFaceText(width: number, height: number, vertical: boolean): SliderFaceText {
  const thickness = vertical ? width : height;
  const length = vertical ? height : width;
  return {
    name: thickness >= (vertical ? 88 : 40) && length >= (vertical ? 140 : 176),
    percentage: thickness >= (vertical ? 56 : 32) && length >= (vertical ? 88 : 112),
  };
}

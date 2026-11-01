import type { StepListPath } from './scenario-edit';

export type StepDropTarget = { path: StepListPath; index: number };

const targets = new WeakMap<Element, StepDropTarget>();

/** Marks an element as a place a dragged step can land: index `index` of the list at `path`. */
export function stepDrop(node: HTMLElement, target: StepDropTarget) {
  node.setAttribute('data-step-drop', '');
  targets.set(node, target);
  return {
    update(next: StepDropTarget) {
      targets.set(node, next);
    },
  };
}

export const stepDropTarget = (zone: Element) => targets.get(zone);

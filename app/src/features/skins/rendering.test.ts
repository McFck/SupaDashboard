import { afterEach, describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import type { ControlFaceProps } from '../controls/model';
import { controlTypes, skins } from '../plugins/registry';
import { effectiveSize } from '../layout/skin-layouts';
import { type SkinDef } from './contracts';

const typeId = 'skin-rendering-button';
const skinId = 'skin-rendering-test';
const defaultFace = {} as Component<ControlFaceProps>;
const customFace = {} as Component<ControlFaceProps>;
const skin: SkinDef = {
  id: skinId,
  title: 'Rendering test',
  component: {} as Component<{ page: import('../settings/schema').Page }>,
  slots: [
    {
      id: 'main',
      style: 'region',
      kind: 'grid',
      grid: { rows: 1, cols: 2, size: 80, gap: 8, sizing: 'auto' },
    },
  ],
  views: [{ id: 'default', title: 'Default', slots: ['main'] }],
  defaultView: 'default',
  controlSkins: {
    [typeId]: {
      component: customFace,
      sizes: { main: { min: { w: 1, h: 1 }, default: { w: 2, h: 1 }, max: { w: 3, h: 2 } } },
    },
  },
};

afterEach(() => {
  controlTypes.delete(typeId);
  skins.delete(skinId);
});

describe('skin control rendering', () => {
  it('resolves renderer sizing within the destination slot capacity', () => {
    skins.set(skinId, skin);
    controlTypes.set(typeId, {
      type: typeId,
      title: 'Button',
      icon: 'Square',
      component: {} as any,
      face: defaultFace,
      size: { w: 1, h: 1 },
      maxSize: { w: 6, h: 6 },
      create: () => ({ name: 'Button', variants: [] }),
    });
    const resolved = effectiveSize(skinId, skin.slots[0], typeId);
    expect(resolved).toEqual({ min: { w: 1, h: 1 }, default: { w: 2, h: 1 }, max: { w: 2, h: 1 } });
  });
});

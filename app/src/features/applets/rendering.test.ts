import { afterEach, describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import type { ControlFaceProps } from '../controls/model';
import { controlTypes, applets } from '../plugins/registry';
import { effectiveSize } from '../layout/applet-layouts';
import { type AppletDef } from './contracts';

const typeId = 'applet-rendering-button';
const appletId = 'applet-rendering-test';
const defaultFace = {} as Component<ControlFaceProps>;
const customFace = {} as Component<ControlFaceProps>;
const applet: AppletDef = {
  id: appletId,
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
  controlFaces: {
    [typeId]: {
      component: customFace,
      sizes: { main: { min: { w: 1, h: 1 }, default: { w: 2, h: 1 }, max: { w: 3, h: 2 } } },
    },
  },
};

afterEach(() => {
  controlTypes.delete(typeId);
  applets.delete(appletId);
});

describe('applet control rendering', () => {
  it('resolves renderer sizing within the destination slot capacity', () => {
    applets.set(appletId, applet);
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
    const resolved = effectiveSize(appletId, applet.slots[0], typeId);
    expect(resolved).toEqual({ min: { w: 1, h: 1 }, default: { w: 2, h: 1 }, max: { w: 2, h: 1 } });
  });
});
